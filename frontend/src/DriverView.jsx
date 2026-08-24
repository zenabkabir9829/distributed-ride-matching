import { useEffect, useState, useRef } from 'react';

export default function DriverView() {
  const [rides, setRides] = useState([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const driverId = 'driver1'; // hardcoded for demo

  useEffect(() => {
  let ws;
  let isMounted = true;

  const connect = () => {
    ws = new WebSocket('wss://ride-matching-backend.onrender.com');
    wsRef.current = ws;

    ws.onopen = () => {
      if (!isMounted) return;
      setConnected(true);
      ws.send(JSON.stringify({ type: 'register', userId: driverId }));
    };

    ws.onmessage = (event) => {
      if (!isMounted) return;
      const data = JSON.parse(event.data);
      if (data.type === 'new_ride_request') {
        setRides((prev) => [data, ...prev]);
      }
    };

    ws.onclose = () => {
      if (isMounted) setConnected(false);
    };
  };

  connect();

  return () => {
    isMounted = false;
    ws?.close();
  };
}, []);

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h2>Driver Dashboard — {driverId}</h2>
      <p>Status: {connected ? '🟢 Connected' : '🔴 Disconnected'}</p>
      <h3>Incoming Ride Requests</h3>
      {rides.length === 0 && <p>Waiting for ride requests...</p>}
      <ul>
        {rides.map((r, i) => (
          <li key={i} style={{ marginBottom: '8px', padding: '10px', background: '#f0f0f0', borderRadius: '4px' }}>
            New ride from rider <b>{r.riderId}</b> — Trip ID: {r.tripId}
          </li>
        ))}
      </ul>
    </div>
  );
}