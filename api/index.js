'use strict';

// Vercel 서버리스 함수 진입점.
// server.js 는 app 을 export 하며(리슨은 로컬에서만), 여기서 그대로 핸들러로 사용합니다.
module.exports = require('../server');
