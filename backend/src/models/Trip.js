const mongoose = require('mongoose');

const tripSchema = new mongoose.Schema({
  driverId: { type: String, required: true },
  riderId: { type: String, required: true },
  status: { type: String, enum: ['assigned', 'ongoing', 'completed', 'cancelled'], default: 'assigned' },
  startLocation: { lat: Number, lng: Number },
  endLocation: { lat: Number, lng: Number },
}, { timestamps: true });

module.exports = mongoose.model('Trip', tripSchema);