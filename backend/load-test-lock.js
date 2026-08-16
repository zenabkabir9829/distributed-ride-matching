const axios = require('axios');

async function testConcurrentLock() {
  // Reset driver1 to available first
  const riders = Array.from({ length: 20 }, (_, i) => `rider${i}`);

  const requests = riders.map(riderId =>
    axios.post('http://localhost:4000/rides/request', {
      driverId: 'driver1',
      riderId,
    }).then(res => ({ riderId, ...res.data }))
      .catch(err => ({ riderId, error: err.message }))
  );

  const results = await Promise.all(requests);

  const successes = results.filter(r => r.success);
  const failures = results.filter(r => !r.success);

  console.log(`Total requests: ${results.length}`);
  console.log(`Successful matches: ${successes.length}`);
  console.log(`Blocked (correctly): ${failures.length}`);
  console.log('Winner:', successes[0]);
}

testConcurrentLock();