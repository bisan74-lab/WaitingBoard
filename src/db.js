'use strict';

/**
 * 저장소 백엔드 선택기.
 *
 *  - Redis(Upstash/Vercel KV) 환경변수가 있으면 → Redis 사용 (서버리스/운영)
 *  - 없으면 → 파일(JSON) 사용 (로컬 개발)
 *
 * 모든 함수는 Promise를 반환합니다(비동기 통일).
 */

const redis = require('./stores/redis');
const file = require('./stores/file');

const backend = redis.isConfigured() ? redis : file;

if (backend.backend === 'redis') {
  console.log('[store] Redis(KV) 백엔드 사용');
} else if (process.env.VERCEL) {
  console.warn(
    '[store] ⚠ Vercel 환경인데 KV(Redis)가 설정되지 않았습니다. ' +
      '서버리스에서는 파일 저장이 유지되지 않아 대기 데이터가 사라집니다. ' +
      'KV_REST_API_URL / KV_REST_API_TOKEN 환경변수를 설정하세요.'
  );
} else {
  console.log('[store] 파일(JSON) 백엔드 사용');
}

module.exports = backend;
