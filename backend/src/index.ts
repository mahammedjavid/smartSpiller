import { config } from './config.js';
import { createApp } from './app.js';

createApp().listen(config.port, () => {
  console.log(`Smart Splitter API on :${config.port} · model ${config.geminiModel}`);
});
