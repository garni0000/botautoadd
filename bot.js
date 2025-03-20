require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { MongoClient } = require('mongodb');
const http = require('http');

// ======================
// 🛠 CONFIGURATION
// ======================
const config = {
  mongo: {
    uri: process.env.MONGO_URI,
    dbName: process.env.DB_NAME
  },
  bots: [
    {
      name: 'BOT_1',
      token: process.env.BOT_1_TOKEN,
      channels: process.env.BOT_1_CHANNELS.split(','),
      message: process.env.BOT_1_MESSAGE,
      buttons: JSON.parse(process.env.BOT_1_BUTTONS),
      approveTime: process.env.BOT_1_APPROVE_TIME * 1000 * 60, // Conversion en ms
      collection: process.env.BOT_1_COLLECTION
    },
    {
      name: 'BOT_2',
      token: process.env.BOT_2_TOKEN,
      channels: process.env.BOT_2_CHANNELS.split(','),
      message: process.env.BOT_2_MESSAGE,
      buttons: JSON.parse(process.env.BOT_2_BUTTONS),
      approveTime: process.env.BOT_2_APPROVE_TIME * 1000 * 60,
      collection: process.env.BOT_2_COLLECTION
    }
  ],
  admin: {
    id: parseInt(process.env.ADMIN_ID)
  }
};

// ======================
// 🚀 INITIALISATION
// ======================
const mongoClient = new MongoClient(config.mongo.uri);
let db;

// Création des instances de bots
const bots = config.bots.map(botConfig => ({
  ...botConfig,
  instance: new TelegramBot(botConfig.token, { polling: true })
}));

// ======================
// 🗃 FONCTIONS DATABASE
// ======================
async function connectDB() {
  try {
    await mongoClient.connect();
    db = mongoClient.db(config.mongo.dbName);
    console.log('✅ Connecté à MongoDB');
  } catch (error) {
    console.error('❌ Erreur MongoDB:', error);
    process.exit(1);
  }
}

async function saveUser(botConfig, userData) {
  try {
    await db.collection(botConfig.collection).updateOne(
      { userId: userData.id },
      {
        $set: {
          ...userData,
          timestamp: new Date(),
          status: 'pending'
        }
      },
      { upsert: true }
    );
  } catch (error) {
    console.error('❌ Erreur sauvegarde:', error);
  }
}

// ======================
// 📨 FONCTIONS MESSAGERIE
// ======================
async function sendWelcomeMessage(botConfig, userId, userName) {
  try {
    const formattedMessage = botConfig.message
      .replace(/{userName}/g, userName)
      .replace(/{time}/g, (botConfig.approveTime / 60000));

    await botConfig.instance.sendMessage(userId, formattedMessage, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: botConfig.buttons },
      disable_web_page_preview: true
    });

    console.log(`✅ [${botConfig.name}] Message envoyé à ${userName}`);
  } catch (error) {
    console.error(`❌ [${botConfig.name}] Erreur envoi:`, error.message);
  }
}

async function approveRequest(botConfig, chatId, userId) {
  try {
    await botConfig.instance.approveChatJoinRequest(chatId, userId);
    console.log(`✅ [${botConfig.name}] Demande approuvée pour ${userId}`);

    await db.collection(botConfig.collection).updateOne(
      { userId },
      { $set: { status: 'approved', approvedAt: new Date() } }
    );
  } catch (error) {
    console.error(`❌ [${botConfig.name}] Erreur approbation:`, error.message);
  }
}

// ======================
// 🕹 GESTION DES BOTS
// ======================
function setupBotHandlers(botConfig) {
  botConfig.instance.on('chat_join_request', async (req) => {
    const chatId = req.chat.id.toString();
    const user = req.from;
    
    if (!botConfig.channels.includes(chatId)) return;

    console.log(`🔔 [${botConfig.name}] Nouvelle demande de ${user.first_name}`);

    // Sauvegarde utilisateur
    await saveUser(botConfig, {
      id: user.id,
      chatId,
      username: user.username,
      firstName: user.first_name
    });

    // Envoi message après 2 secondes
    setTimeout(() => {
      sendWelcomeMessage(botConfig, user.id, user.first_name);
    }, 2000);

    // Approbation automatique
    setTimeout(() => {
      approveRequest(botConfig, chatId, user.id);
    }, botConfig.approveTime);
  });

  // ======================
  // 👮 ADMIN COMMANDS
  // ======================
  botConfig.instance.onText(/\/admin/, async (msg) => {
    if (msg.from.id !== config.admin.id) return;

    const stats = await db.collection(botConfig.collection).aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 }
        }
      }
    ]).toArray();

    const message = `📊 Statistiques pour ${botConfig.name}:\n` +
      stats.map(s => `• ${s._id}: ${s.count}`).join('\n');

    botConfig.instance.sendMessage(msg.chat.id, message);
  });
}

// ======================
// 🚀 LANCEMENT APPLICATION
// ======================
(async () => {
  await connectDB();
  
  // Initialisation des bots
  bots.forEach(bot => {
    setupBotHandlers(bot);
    console.log(`🤖 ${bot.name} initialisé (${bot.channels.length} canaux)`);
  });

  // Serveur keep-alive
  http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('🏃 Serveur en cours d\'exécution');
  }).listen(process.env.PORT || 3000);

  console.log('🚀 Application démarrée');
})();