/* jp-tree.js — 教培业务库 树模型
 * 纯逻辑模块：不依赖 DOM，也不依赖任何存储实现，可被 Node 直接 require 做单测。
 * 结构：root(虚拟根) → school(学校, folder) → project(项目, folder) → … → file
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JPTree = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_NAME = 80;
  // Windows/macOS 非法文件名字符 + 控制字符
  var ILLEGAL = /[\\/:*?"<>|\u0000-\u001f]/g;
  var RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

  function uid(prefix) {
    return (prefix || 'n') + '_' + Date.now().toString(36) + '_' +
      Math.random().toString(36).slice(2, 8);
  }

  /* 名称清洗：去非法字符、压缩空白、去前导点、截断超长 */
  function sanitizeName(name) {
    var s = String(name == null ? '' : name);
    s = s.replace(ILLEGAL, ' ').replace(/\s+/g, ' ').trim();
    s = s.replace(/^\.+/, '').trim();
    if (RESERVED.test(s)) s = s + '_';
    if (s.length > MAX_NAME) s = s.slice(0, MAX_NAME).trim();
    return s;
  }

  function createRoot() {
    return { id: 'root', name: '教培业务库', type: 'folder', source: 'root', children: [] };
  }

  function makeFolder(name, source) {
    return {
      id: uid('f'),
      name: sanitizeName(name) || '未命名文件夹',
      type: 'folder',
      source: source || 'user',
      children: [],
      createdAt: Date.now()
    };
  }

  function makeFile(name, meta) {
    meta = meta || {};
    return {
      id: uid('d'),
      name: sanitizeName(name) || '未命名文件',
      type: 'file',
      source: meta.source || 'user',
      size: meta.size || 0,
      mime: meta.mime || '',
      relPath: meta.relPath || '',
      blobKey: meta.blobKey || null,
      createdAt: Date.now()
    };
  }

  /* 深度优先查找，返回 { node, parent, index, path:[父链节点] } */
  function find(root, id) {
    var stack = [{ node: root, parent: null, index: -1, path: [] }];
    while (stack.length) {
      var cur = stack.pop();
      if (cur.node.id === id) return cur;
      var kids = cur.node.children || [];
      for (var i = kids.length - 1; i >= 0; i--) {
        stack.push({
          node: kids[i],
          parent: cur.node,
          index: i,
          path: cur.path.concat([cur.node])
        });
      }
    }
    return null;
  }

  /* 同级重名时生成 "名称 (2)" */
  function uniqueName(parent, name) {
    var base = sanitizeName(name) || '未命名';
    var taken = {};
    (parent.children || []).forEach(function (c) { taken[c.name.toLowerCase()] = true; });
    if (!taken[base.toLowerCase()]) return base;
    for (var i = 2; i < 1000; i++) {
      var cand = base + ' (' + i + ')';
      if (!taken[cand.toLowerCase()]) return cand;
    }
    return base + ' (' + Date.now() + ')';
  }

  /* 新建文件夹；dup: 'auto' 自动加序号 | 'merge' 复用同名 */
  function addFolder(parent, name, opts) {
    opts = opts || {};
    if (!parent || parent.type !== 'folder') throw new Error('addFolder: 目标不是文件夹');
    var clean = sanitizeName(name);
    if (!clean) throw new Error('文件夹名称不能为空');
    if (opts.dup === 'merge') {
      var hit = (parent.children || []).filter(function (c) {
        return c.type === 'folder' && c.name.toLowerCase() === clean.toLowerCase();
      })[0];
      if (hit) return hit;
    }
    var f = makeFolder(opts.dup === 'merge' ? clean : uniqueName(parent, clean), opts.source || 'user');
    parent.children.push(f);
    return f;
  }

  /* 重命名：同级重名自动加序号；返回最终名称 */
  function rename(root, id, newName) {
    var hit = find(root, id);
    if (!hit) throw new Error('rename: 节点不存在');
    var clean = sanitizeName(newName);
    if (!clean) throw new Error('名称不能为空');
    var parent = hit.parent || root;
    var same = (parent.children || []).filter(function (c) {
      return c.id !== id && c.name.toLowerCase() === clean.toLowerCase();
    });
    var finalName = same.length ? uniqueName(
      { children: (parent.children || []).filter(function (c) { return c.id !== id; }) },
      clean
    ) : clean;
    hit.node.name = finalName;
    hit.node.updatedAt = Date.now();
    return finalName;
  }

  /* 删除节点，返回被删除子树（用于撤销 / 连带清理 blob） */
  function remove(root, id) {
    var hit = find(root, id);
    if (!hit || !hit.parent) return null;
    hit.parent.children.splice(hit.index, 1);
    return hit.node;
  }

  /* 判断 id 是否落在 node 子树内（含自身） */
  function isDescendant(node, id) {
    if (!node) return false;
    if (node.id === id) return true;
    return (node.children || []).some(function (c) {
      return c.type === 'folder' && isDescendant(c, id);
    });
  }

  /* 移动节点到目标文件夹；禁止移动到自身或其后代（防环） */
  function move(root, id, targetId) {
    if (id === targetId) throw new Error('不能移动到自身');
    var src = find(root, id);
    var dst = find(root, targetId);
    if (!src) throw new Error('源节点不存在');
    if (!dst) throw new Error('目标节点不存在');
    if (dst.node.type !== 'folder') throw new Error('目标不是文件夹');
    if (src.node.type === 'folder' && isDescendant(src.node, targetId)) {
      throw new Error('不能移动到自己的子文件夹内');
    }
    src.parent.children.splice(src.index, 1);
    dst.node.children.push(src.node);
    return src.node;
  }

  /* 按路径段逐级确保文件夹存在，返回叶子文件夹 */
  function ensurePath(root, segments, source) {
    var cur = root;
    (segments || []).forEach(function (seg) {
      var clean = sanitizeName(seg);
      if (!clean) return;
      cur = addFolder(cur, clean, { dup: 'merge', source: source || 'dropped' });
    });
    return cur;
  }

  /* 拖拽入库核心：把「学校/项目/…」相对路径还原成层级，再挂文件 */
  function insertByRelPath(root, relPath, fileMeta) {
    var parts = String(relPath || '').split('/').filter(function (s) { return s && s !== '.'; });
    var fileName = parts.pop() || (fileMeta && fileMeta.name) || '未命名文件';
    var dir = ensurePath(root, parts, 'dropped');
    var node = makeFile(fileName, Object.assign({ source: 'dropped', relPath: relPath }, fileMeta || {}));
    var hit = (dir.children || []).filter(function (c) {
      return c.type === 'file' && c.name.toLowerCase() === node.name.toLowerCase();
    })[0];
    if (hit) { hit.blobKey = node.blobKey; hit.size = node.size; hit.updatedAt = Date.now(); return hit; }
    dir.children.push(node);
    return node;
  }

  function walk(node, cb, depth) {
    depth = depth || 0;
    cb(node, depth);
    (node.children || []).forEach(function (c) { walk(c, cb, depth + 1); });
  }

  function count(node) {
    var folders = 0, files = 0, bytes = 0;
    walk(node, function (n) {
      if (n === node) return;
      if (n.type === 'folder') folders++;
      else { files++; bytes += (n.size || 0); }
    });
    return { folders: folders, files: files, bytes: bytes };
  }

  /* 收集子树内所有 blobKey，删除时用于清理存储 */
  function collectBlobKeys(node) {
    var keys = [];
    walk(node, function (n) { if (n.type === 'file' && n.blobKey) keys.push(n.blobKey); });
    return keys;
  }

  function listSchools(root) {
    return (root.children || []).filter(function (c) { return c.type === 'folder'; });
  }

  function findByPath(root, segments) {
    var cur = root;
    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      var next = (cur.children || []).filter(function (c) { return c.name === seg; })[0];
      if (!next) return null;
      cur = next;
    }
    return cur;
  }

  /* 序列化：剥离运行时字段，保持导出包干净 */
  function serialize(root) {
    function strip(n) {
      var o = { id: n.id, name: n.name, type: n.type, source: n.source };
      if (n.type === 'file') {
        o.size = n.size || 0; o.mime = n.mime || ''; o.relPath = n.relPath || ''; o.blobKey = n.blobKey || null;
      } else {
        o.children = (n.children || []).map(strip);
      }
      return o;
    }
    return { format: 'jiaopei-vault', version: 1, exportedAt: new Date().toISOString(), root: strip(root) };
  }

  function deserialize(pkg) {
    if (!pkg || pkg.format !== 'jiaopei-vault') throw new Error('不是有效的教培业务库导出包');
    var r = pkg.root || {};
    var out = createRoot();
    function rebuild(src, dst) {
      dst.name = sanitizeName(src.name) || dst.name;
      dst.source = src.source || 'imported';
      (src.children || []).forEach(function (c) {
        if (c.type === 'folder') {
          var f = makeFolder(c.name, 'imported');
          dst.children.push(f);
          rebuild(c, f);
        } else {
          dst.children.push(makeFile(c.name, {
            size: c.size, mime: c.mime, relPath: c.relPath,
            blobKey: c.blobKey, source: 'imported'
          }));
        }
      });
    }
    rebuild(r, out);
    return out;
  }

  /* 导入合并：同名文件夹递归合并，文件同名则跳过；返回统计 */
  function mergeInto(target, incoming) {
    var stat = { foldersAdded: 0, filesAdded: 0, filesSkipped: 0 };
    function merge(tDst, sSrc) {
      (sSrc.children || []).forEach(function (src) {
        if (src.type === 'folder') {
          var hit = (tDst.children || []).filter(function (c) {
            return c.type === 'folder' && c.name.toLowerCase() === String(src.name).toLowerCase();
          })[0];
          if (!hit) { hit = makeFolder(src.name, 'imported'); tDst.children.push(hit); stat.foldersAdded++; }
          merge(hit, src);
        } else {
          var dup = (tDst.children || []).filter(function (c) {
            return c.type === 'file' && c.name.toLowerCase() === String(src.name).toLowerCase();
          })[0];
          if (dup) { stat.filesSkipped++; return; }
          tDst.children.push(makeFile(src.name, {
            size: src.size, mime: src.mime, relPath: src.relPath,
            blobKey: src.blobKey, source: 'imported'
          }));
          stat.filesAdded++;
        }
      });
    }
    merge(target, incoming);
    return stat;
  }

  function formatSize(bytes) {
    var b = Number(bytes) || 0;
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
    return (b / 1073741824).toFixed(2) + ' GB';
  }

  function extOf(name) {
    var i = String(name || '').lastIndexOf('.');
    return i > 0 ? String(name).slice(i + 1).toLowerCase() : '';
  }

  /* 文件类型 → 图标 / 配色（纯文本符号，不用 emoji 字体依赖） */
  var ICON_MAP = {
    pdf: ['PDF', '#e5484d'], doc: ['DOC', '#2b6cb0'], docx: ['DOC', '#2b6cb0'],
    xls: ['XLS', '#2f855a'], xlsx: ['XLS', '#2f855a'], csv: ['CSV', '#2f855a'],
    ppt: ['PPT', '#c05621'], pptx: ['PPT', '#c05621'],
    jpg: ['IMG', '#805ad5'], jpeg: ['IMG', '#805ad5'], png: ['IMG', '#805ad5'],
    gif: ['IMG', '#805ad5'], bmp: ['IMG', '#805ad5'], webp: ['IMG', '#805ad5'],
    txt: ['TXT', '#718096'], md: ['MD', '#718096'], json: ['JSON', '#718096'],
    zip: ['ZIP', '#975a16'], rar: ['ZIP', '#975a16'], '7z': ['ZIP', '#975a16'],
    mp4: ['VID', '#b83280'], mov: ['VID', '#b83280'], mp3: ['AUD', '#b83280']
  };

  function fileBadge(name) {
    var e = extOf(name);
    return ICON_MAP[e] ? { label: ICON_MAP[e][0], color: ICON_MAP[e][1], ext: e }
      : { label: e ? e.toUpperCase().slice(0, 4) : 'FILE', color: '#718096', ext: e };
  }

  return {
    MAX_NAME: MAX_NAME,
    uid: uid,
    sanitizeName: sanitizeName,
    createRoot: createRoot,
    makeFolder: makeFolder,
    makeFile: makeFile,
    find: find,
    uniqueName: uniqueName,
    addFolder: addFolder,
    rename: rename,
    remove: remove,
    move: move,
    ensurePath: ensurePath,
    insertByRelPath: insertByRelPath,
    walk: walk,
    count: count,
    collectBlobKeys: collectBlobKeys,
    listSchools: listSchools,
    findByPath: findByPath,
    serialize: serialize,
    deserialize: deserialize,
    mergeInto: mergeInto,
    formatSize: formatSize,
    extOf: extOf,
    fileBadge: fileBadge
  };
});
