// Example frontend snippet for listening to subscription push task updates.
// Replace HOST with your backend host (e.g., wss://admin.example.com).
const socket = new WebSocket('wss://HOST/ws/subscription-push-task');

socket.addEventListener('open', () => {
  console.log('connected to subscription push task stream');
});

socket.addEventListener('message', (event) => {
  try {
    const task = JSON.parse(event.data);
    const progress = typeof task.progressPercent === 'number' ? `${task.progressPercent}%` : 'n/a';
    console.log(
      `Task ${task.id} [${task.status}] total=${task.totalTargets} ` +
      `success=${task.successCount} failure=${task.failureCount} progress=${progress}`
    );
  } catch (err) {
    console.error('Unable to parse task update', err);
  }
});

socket.addEventListener('close', () => {
  console.log('subscription push task stream closed');
});

socket.addEventListener('error', (err) => {
  console.error('subscription push task stream error', err);
});
