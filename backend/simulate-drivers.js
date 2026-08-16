const axios = require('axios');

const BASE_URL = 'http://localhost:4000';

// Starting points for our fake drivers
const drivers = [
  { id: 'driver1', lat: 26.9124, lng: 75.7873 },
  { id: 'driver2', lat: 26.9200, lng: 75.7900 },
];

function randomStep() {
  // Small random movement, roughly 50-150 meters per tick
  return (Math.random() - 0.5) * 0.002;
}

async function moveDrivers() {
  for (const driver of drivers) {
    driver.lat += randomStep();
    driver.lng += randomStep();

    try {
      await axios.post(`${BASE_URL}/driver/${driver.id}/location`, {
        lat: driver.lat,
        lng: driver.lng,
      });
      console.log(`${driver.id} moved to`, driver.lat.toFixed(5), driver.lng.toFixed(5));
    } catch (err) {
      console.error(`Failed to update ${driver.id}`, err.message);
    }
  }
}

console.log('Starting driver simulation... (Ctrl+C to stop)');
setInterval(moveDrivers, 2000); // move every 2 seconds