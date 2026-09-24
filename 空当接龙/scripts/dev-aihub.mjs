process.env.THEME_GENERATOR_MODE = 'aihub';
process.env.ALLOW_GENERATION_FALLBACK = '0';
process.env.WEB_PORT ||= '4283';
process.env.API_PORT ||= '4284';
process.env.WEB_ORIGIN = `http://localhost:${process.env.WEB_PORT},http://127.0.0.1:${process.env.WEB_PORT}`;
await import('./dev.mjs');
