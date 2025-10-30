// Example: connect to WebSocket heartbeat endpoint with a token
const token = 'REPLACE_WITH_TOKEN';
const ws = new WebSocket(`ws://localhost:8080/ws/heartbeat?token=${encodeURIComponent(token)}`);

ws.addEventListener('open', () => {
  // Send a simple heartbeat every 5 seconds
  setInterval(() => {
    ws.send('ping');
  }, 5000);
});

ws.addEventListener('close', () => {
  console.log('Heartbeat connection closed');
});
