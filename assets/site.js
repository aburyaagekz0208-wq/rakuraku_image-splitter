/*
 * らくらく画像ツール 共通スクリプト
 *  1. ナビ: 今いるページに印を付け、スマホで横にスクロールする一段のバーを今のページの位置に合わせる
 *  2. 保存: スマホでは画像そのものとして保存する（zip やファイルアプリ行きで写真アプリに出ない問題の対策）
 *     - iPhone / iPad: 共有メニュー（Web Share API）を開き「画像を保存」で写真アプリへ入れる
 *     - Android: 画像を 1 枚ずつダウンロード（Download フォルダ → フォト・ギャラリーに表示される）
 *     - パソコン: これまで通り順番にダウンロード
 * ページの <head> で defer なしに読み込む（ページ下部のスクリプトから RakurakuSave を呼ぶため）。
 */
(function () {
  'use strict';

  var ua = navigator.userAgent || '';
  var isIOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var isAndroid = /Android/i.test(ua);
  var env = isIOS ? 'ios' : (isAndroid ? 'android' : 'pc');

  /* ---------- 1. ナビ ---------- */
  function setupNav() {
    var here = '';
    try { here = decodeURIComponent(location.pathname.split('/').pop() || ''); } catch (e) { here = ''; }
    if (!here) here = 'index.html';

    var lists = document.querySelectorAll('.nav-links, .site-links');
    Array.prototype.forEach.call(lists, function (list) {
      Array.prototype.forEach.call(list.querySelectorAll('a'), function (a) {
        var href = (a.getAttribute('href') || '').split('#')[0];
        if (href && href === here) a.setAttribute('aria-current', 'page');
      });

      var update = function () {
        var max = list.scrollWidth - list.clientWidth;
        list.classList.toggle('can-left', max > 2 && list.scrollLeft > 2);
        list.classList.toggle('can-right', max > 2 && list.scrollLeft < max - 2);
      };

      var cur = list.querySelector('[aria-current="page"]');
      if (cur && list.scrollWidth > list.clientWidth) {
        list.scrollLeft = cur.offsetLeft - list.offsetLeft - (list.clientWidth - cur.offsetWidth) / 2;
      }
      list.addEventListener('scroll', update, { passive: true });
      window.addEventListener('resize', update);
      update();
    });
  }

  /* ---------- 2. 保存 ---------- */
  function canShareFiles(files) {
    try { return !!(navigator.share && navigator.canShare && navigator.canShare({ files: files })); }
    catch (e) { return false; }
  }

  // 保存リンク（<a download>）に、共有メニューへ渡す File を先に用意しておく。
  // iPhone の共有メニューはボタンを押した直後にしか開けないため、押してから作るのでは間に合わない。
  function track(link, blob) {
    var name = link.getAttribute('download') || 'image.png';
    link._rkReady = (blob ? Promise.resolve(blob) : fetch(link.href).then(function (r) { return r.blob(); }))
      .then(function (b) {
        link._rkFile = new File([b], name, { type: b.type || 'image/png' });
        return link._rkFile;
      })
      .catch(function () { return null; });

    if (env === 'ios' && !link._rkBound) {
      link._rkBound = true;
      link.addEventListener('click', function (ev) {
        if (link._rkPlain) return; // 共有に失敗した時の通常ダウンロード
        var f = link._rkFile;
        if (!f || !canShareFiles([f])) return; // 用意できていなければ通常のダウンロードに任せる
        ev.preventDefault();
        navigator.share({ files: [f] }).catch(function (err) {
          if (err && err.name === 'AbortError') return;
          link._rkPlain = true; link.click(); link._rkPlain = false;
        });
      });
    }
    return link._rkReady;
  }

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // 一括保存ボタンをつなぐ。getLinks は保存リンク（<a download>）の一覧を返す関数。
  function bindBulk(btn, getLinks) {
    var hint = document.createElement('p');
    hint.className = 'save-hint';
    if (env === 'ios') {
      btn.textContent = '📷 すべて写真に保存';
      hint.textContent = '共有メニューが開いたら「画像を保存」を選ぶと、写真アプリにまとめて入ります。';
    } else if (env === 'android') {
      btn.textContent = '📷 すべて画像で保存';
      hint.textContent = '1枚ずつ画像で保存され、フォトやギャラリーのアプリにも表示されます。「複数のファイルをダウンロード」の確認が出たら「許可」を押してください。';
    }
    if (hint.textContent) {
      btn.insertAdjacentElement('afterend', hint);
      // ボタンを隠しているページ（SNS画像の1枚だけの時など）では説明も隠す
      var syncHint = function () { hint.style.display = btn.style.display === 'none' ? 'none' : ''; };
      new MutationObserver(syncHint).observe(btn, { attributes: true, attributeFilter: ['style'] });
      syncHint();
    }
    var idleLabel = btn.textContent;
    var defaultHint = hint.textContent;

    function finish(label) {
      btn.textContent = label;
      setTimeout(function () { btn.disabled = false; btn.textContent = idleLabel; hint.textContent = defaultHint; }, 2500);
    }

    btn.addEventListener('click', async function () {
      var links = Array.prototype.slice.call(getLinks());
      if (links.length === 0) return;

      if (env === 'ios') {
        var files = links.map(function (l) { return l._rkFile; });
        if (files.every(Boolean)) {
          if (canShareFiles(files)) {
            try {
              await navigator.share({ files: files });
              btn.disabled = true; finish('✅ 保存しました');
            } catch (err) {
              if (!err || err.name !== 'AbortError') {
                hint.textContent = '共有メニューを開けませんでした。もう一度ボタンを押すか、画像を長押しして「"写真"に保存」を選んでください。';
              }
            }
            return;
          }
          // 共有に対応していない古い iOS は、下のダウンロードへ進む
        } else {
          // まだ用意ができていない（大きい画像など）。用意してから、もう一度押してもらう
          btn.disabled = true; btn.textContent = '⏳ 準備中...';
          await Promise.all(links.map(function (l) { return l._rkReady || track(l); }));
          btn.disabled = false; btn.textContent = '📷 準備OK・もう一度タップ';
          return;
        }
      }

      if (env === 'pc' && !confirm(links.length + '枚の画像を順番にダウンロードします。ブラウザから許可を求められたら「許可」を押してください。')) return;

      btn.disabled = true; btn.textContent = '📦 保存中...';
      for (var i = 0; i < links.length; i++) {
        links[i]._rkPlain = true; links[i].click(); links[i]._rkPlain = false;
        await wait(env === 'android' ? 700 : 500);
      }
      finish('✅ 完了！');
    });
  }

  window.RakurakuSave = { env: env, track: track, bindBulk: bindBulk, canShareFiles: canShareFiles };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupNav);
  else setupNav();
})();
