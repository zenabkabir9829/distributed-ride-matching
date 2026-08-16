const mongoose = require('mongoose');

async function connectMongo() {
  await mongoose.connect('mongodb://localhost:27018/ridematching');
  console.log('MongoDB connected');
}

module.exports = connectMongo;