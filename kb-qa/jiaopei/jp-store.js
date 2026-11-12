/* jp-store.js — 教培业务库 存储层
 * 把存储抽成 adapter：当前用 IndexedDB（blob 与树结构分表存，避免大文件拖垮树 JSON）。
 * 未来要上云（WorkBuddy 云服务 / 微盘桥接）只需替换本文件的实现，UI 层不感知。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JPStore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DB_NAME = 'jiaopei-vault';
  var DB_VER = 1;
  var ST_TREE = 'meta';    // 树结构，单条记录 key='root'
  var ST_BLOB = 'blobs';   // 文件二进制，key=blobKey
  var LS_FALLBACK = 'jiaopei_vault_fallback';

  var _db = null;
  var _memory = null;      // 无 IndexedDB 时的内存兜底

  function hasIDB() {
    try { return typeof indexedDB !== 'undefined' && indexedDB !== null; }
    catch (e) { return false; }
  }

  function open() {
    if (_db) return Promise.resolve(_db);
    if (!hasIDB()) return Promise.reject(new Error('no-indexeddb'));
    return new Promise(function (res, rej) {
      var req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(ST_TREE)) db.createObjectStore(ST_TREE);
        if (!db.objectStoreNames.contains(ST_BLOB)) db.createObjectStore(ST_BLOB);
      };
      req.onsuccess = function () { _db = req.result; res(_db); };
      req.onerror = function () { rej(req.error || new Error('idb-open-failed')); };
    });
  }

  function tx(store, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction(store, mode);
        var s = t.objectStore(store);
        var req;
        try { req = fn(s); } catch (e) { rej(e); return; }
        t.oncomplete = function () {
          // IDBRequest 的 result 可能为 undefined（查无记录），此时必须返回 undefined 而不是 request 对象本身
          res(req && typeof req === 'object' && 'result' in req ? req.result : req);
        };
        t.onerror = function () { rej(t.error); };
        t.onabort = function () { rej(t.error || new Error('tx-aborted')); };
      });
    });
  }

  /* ---------- 树结构 ---------- */
  function loadTree() {
    if (!hasIDB()) {
      try {
        var raw = localStorage.getItem(LS_FALLBACK);
        return Promise.resolve(raw ? JSON.parse(raw) : null);
      } catch (e) { return Promise.resolve(null); }
    }
    return tx(ST_TREE, 'readonly', function (s) { return s.get('root'); })
      .then(function (v) {
        if (v == null) return null;
        // IndexedDB 里存的是 JSON 字符串，必须反序列化后再交给调用方
        if (typeof v === 'string') {
          try { return JSON.parse(v); } catch (e) { return null; }
        }
        return v;
      })
      .catch(function () {
        try {
          var raw = localStorage.getItem(LS_FALLBACK);
          return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
      });
  }

  function saveTree(tree) {
    var json = JSON.stringify(tree);
    if (!hasIDB()) {
      try { localStorage.setItem(LS_FALLBACK, json); return Promise.resolve(true); }
      catch (e) { return Promise.reject(e); }
    }
    return tx(ST_TREE, 'readwrite', function (s) { s.put(json, 'root'); })
      .then(function () {
        // 双写一份到 localStorage 作为降级备份（树结构通常很小）
        try { localStorage.setItem(LS_FALLBACK, json); } catch (e) { /* 配额满则忽略 */ }
        return true;
      });
  }

  /* ---------- 文件二进制 ---------- */
  function putBlob(key, blob) {
    if (!hasIDB()) { (_memory = _memory || {})[key] = blob; return Promise.resolve(key); }
    return tx(ST_BLOB, 'readwrite', function (s) { s.put(blob, key); }).then(function () { return key; });
  }

  function getBlob(key) {
    if (!hasIDB()) return Promise.resolve((_memory || {})[key] || null);
    return tx(ST_BLOB, 'readonly', function (s) { return s.get(key); })
      .then(function (v) { return v || null; });
  }

  function delBlob(key) {
    if (!hasIDB()) { if (_memory) delete _memory[key]; return Promise.resolve(true); }
    return tx(ST_BLOB, 'readwrite', function (s) { s.delete(key); }).then(function () { return true; });
  }

  function delBlobs(keys) {
    if (!keys || !keys.length) return Promise.resolve(0);
    if (!hasIDB()) { keys.forEach(function (k) { if (_memory) delete _memory[k]; }); return Promise.resolve(keys.length); }
    return tx(ST_BLOB, 'readwrite', function (s) {
      keys.forEach(function (k) { s.delete(k); });
    }).then(function () { return keys.length; });
  }

  function countBlobs() {
    if (!hasIDB()) return Promise.resolve(Object.keys(_memory || {}).length);
    return tx(ST_BLOB, 'readonly', function (s) { return s.count(); });
  }

  function clearAll() {
    if (!hasIDB()) { _memory = {}; try { localStorage.removeItem(LS_FALLBACK); } catch (e) {} return Promise.resolve(true); }
    return Promise.all([
      tx(ST_TREE, 'readwrite', function (s) { s.clear(); }),
      tx(ST_BLOB, 'readwrite', function (s) { s.clear(); })
    ]).then(function () {
      try { localStorage.removeItem(LS_FALLBACK); } catch (e) {}
      return true;
    });
  }

  /* 估算占用（部分浏览器支持） */
  function estimate() {
    if (navigator && navigator.storage && navigator.storage.estimate) {
      return navigator.storage.estimate().catch(function () { return null; });
    }
    return Promise.resolve(null);
  }

  return {
    DB_NAME: DB_NAME,
    hasIDB: hasIDB,
    loadTree: loadTree,
    saveTree: saveTree,
    putBlob: putBlob,
    getBlob: getBlob,
    delBlob: delBlob,
    delBlobs: delBlobs,
    countBlobs: countBlobs,
    clearAll: clearAll,
    estimate: estimate
  };
});
