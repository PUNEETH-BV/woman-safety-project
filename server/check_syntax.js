const fs = require('fs');
const cp = require('child_process');

try {
  cp.execSync('node -c server.js', { cwd: 'c:/Users/punit/OneDrive/Desktop/woman safety project/safety-demo/server' });
  console.log("No syntax errors.");
} catch (e) {
  console.log("Syntax error:", e.message);
  console.log("Stderr:", e.stderr.toString());
}
