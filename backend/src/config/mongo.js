const mongoose = require('mongoose');
require('dotenv').config();

async function connectMongo() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27018/ridematching');
  console.log('MongoDB connected');
}

module.exports = connectMongo;