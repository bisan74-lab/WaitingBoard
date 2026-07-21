/**
 * 카카오톡 공유 헬퍼.
 * /api/public-config 에서 JavaScript 앱키를 받아 SDK를 초기화합니다.
 * 앱키가 없으면 아무 것도 로드하지 않아(버튼은 숨김) 안전합니다.
 *
 * window.WBKakao.share({url, text}) 로 카카오톡 공유창을 엽니다.
 * 준비되면 document 에 'wbkakao:ready' 이벤트를 발생시킵니다.
 */
(function () {
  var cfg = null;
  var inited = false;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function init() {
    try {
      var res = await fetch('/api/public-config');
      cfg = await res.json();
    } catch (e) {
      cfg = {};
    }
    if (!cfg || !cfg.kakaoJsKey) return; // 앱키 없으면 비활성
    try {
      await loadScript('https://t1.kakaocdn.net/kakao_js_sdk/2.7.6/kakao.min.js');
      if (window.Kakao && !window.Kakao.isInitialized()) {
        window.Kakao.init(cfg.kakaoJsKey);
      }
      inited = true;
      document.dispatchEvent(new CustomEvent('wbkakao:ready', { detail: cfg }));
    } catch (e) {
      /* SDK 로드 실패 시 조용히 무시(버튼 숨김 유지) */
    }
  }

  window.WBKakao = {
    get config() { return cfg; },
    isReady: function () { return inited; },
    hasKey: function () { return !!(cfg && cfg.kakaoJsKey); },
    hasChannel: function () { return !!(cfg && cfg.kakaoChannelId); },
    // 순번 링크를 카카오톡으로 공유(본인/친구에게 전송, 순번 저장용)
    share: function (opts) {
      if (!inited || !window.Kakao || !window.Kakao.Share) return false;
      var url = opts.url;
      window.Kakao.Share.sendDefault({
        objectType: 'text',
        text: opts.text || '내 대기 순번 확인하기',
        link: { mobileWebUrl: url, webUrl: url },
        buttonTitle: '내 순번 보기',
      });
      return true;
    },
  };

  init();
})();
