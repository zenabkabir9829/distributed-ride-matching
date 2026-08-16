import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import axios from 'axios';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const JAIPUR_CENTER = [26.9124, 75.7873];
const RIDER_ID = 'riderA'; // hardcoded for demo purposes

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
});

function App() {
  const [drivers, setDrivers] = useState([]);
  const [rideStatus, setRideStatus] = useState(null);
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    const fetchDrivers = async () => {
      try {
        const res = await axios.get('http://localhost:4000/riders/nearby-drivers', {
          params: { lat: JAIPUR_CENTER[0], lng: JAIPUR_CENTER[1], radiusKm: 10 }
        });
        setDrivers(res.data.drivers || []);
      } catch (err) {
        console.error('Failed to fetch drivers', err);
      }
    };

    fetchDrivers();
    const interval = setInterval(fetchDrivers, 3000);
    return () => clearInterval(interval);
  }, []);

  const requestRide = async () => {
    if (drivers.length === 0) {
      setRideStatus('No drivers nearby');
      return;
    }
    setRequesting(true);
    setRideStatus(null);
    try {
      const nearestDriver = drivers[0]; // already sorted ASC by distance from backend
      const res = await axios.post('http://localhost:4000/rides/request', {
        driverId: nearestDriver.id,
        riderId: RIDER_ID,
      });
      if (res.data.success) {
        setRideStatus(`Matched with ${res.data.driverId}! Trip ID: ${res.data.tripId}`);
      } else {
        setRideStatus(`Failed: ${res.data.reason}`);
      }
    } catch (err) {
      setRideStatus('Error requesting ride');
      console.error(err);
    } finally {
      setRequesting(false);
    }
  };

  return (
    <div style={{ height: '100vh', width: '100vw' }}>
      <div style={{ position: 'absolute', zIndex: 1000, background: 'white', padding: '12px', margin: 0, borderRadius: '4px', boxShadow: '0 2px 6px rgba(0,0,0,0.3)' }}>
        <h3 style={{ margin: '0 0 8px 0' }}>Nearby Drivers: {drivers.length}</h3>
        <button onClick={requestRide} disabled={requesting} style={{ padding: '8px 16px', cursor: 'pointer' }}>
          {requesting ? 'Requesting...' : 'Request Ride'}
        </button>
        {rideStatus && <p style={{ marginTop: '8px', maxWidth: '250px' }}>{rideStatus}</p>}
      </div>
      <MapContainer center={JAIPUR_CENTER} zoom={13} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; OpenStreetMap contributors'
        />
        <Marker position={JAIPUR_CENTER}>
          <Popup>You (Rider)</Popup>
        </Marker>
        {drivers.map((d) => (
          <Marker key={d.id} position={[d.lat, d.lng]}>
            <Popup>{d.id}</Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}

export default App;