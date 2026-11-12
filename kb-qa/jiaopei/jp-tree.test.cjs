/* jp-tree.test.cjs — 教培业务库树模型单测（Node 直跑，无依赖） */
const T = require('./jp-tree.js');

let pass = 0, fail = 0;
const fails = [];

function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; fails.push(`${label}\n   期望: ${e}\n   实际: ${a}`); }
}
function ok(cond, label) { cond ? pass++ : (fail++, fails.push(label + ' → 断言为真失败')); }
function throws(fn, label) {
  try { fn(); fail++; fails.push(label + ' → 期望抛错但未抛'); }
  catch (e) { pass++; }
}

console.log('=== 1. 名称清洗 ===');
eq(T.sanitizeName('  芳草地小学  '), '芳草地小学', '首尾空格');
eq(T.sanitizeName('2026春/课后服务'), '2026春 课后服务', '斜杠替换');
eq(T.sanitizeName('a\\b:c*d?e"f<g>h|i'), 'a b c d e f g h i', '全部非法字符');
eq(T.sanitizeName('...隐藏'), '隐藏', '前导点剥离');
eq(T.sanitizeName('con'), 'con_', 'Windows 保留名');
eq(T.sanitizeName('COM1'), 'COM1_', '保留名大小写不敏感');
eq(T.sanitizeName('a\tb\nc'), 'a b c', '控制字符与换行');
eq(T.sanitizeName('x'.repeat(200)).length, 80, '超长截断到 80');
eq(T.sanitizeName(''), '', '空串');
eq(T.sanitizeName(null), '', 'null 安全');
eq(T.sanitizeName(undefined), '', 'undefined 安全');

console.log('=== 2. 建树与同名处理 ===');
{
  const root = T.createRoot();
  const s1 = T.addFolder(root, '芳草地小学');
  eq(root.children.length, 1, '学校已挂到根');
  eq(s1.type, 'folder', '学校是文件夹');
  const s2 = T.addFolder(root, '芳草地小学');
  eq(s2.name, '芳草地小学 (2)', '同名学校自动加序号');
  const p1 = T.addFolder(s1, '2026春 课后服务');
  eq(p1.name, '2026春 课后服务', '项目子文件夹');
  eq(s1.children.length, 1, '项目挂在学校的 children 下');
  throws(() => T.addFolder(root, '   '), '空名文件夹应抛错');
  const merged = T.addFolder(root, '芳草地小学', { dup: 'merge' });
  eq(merged.id, s1.id, 'merge 模式复用同名文件夹');
}

console.log('=== 3. 拖拽整文件夹入库（按相对路径还原层级） ===');
{
  const root = T.createRoot();
  T.insertByRelPath(root, '芳草地小学/2026春课后服务/合同.pdf', { size: 1024 });
  T.insertByRelPath(root, '芳草地小学/2026春课后服务/附件/照片.jpg', { size: 2048 });
  T.insertByRelPath(root, '芳草地小学/2026秋项目/预算.xlsx', { size: 512 });
  T.insertByRelPath(root, '第二中学/资料/简介.docx', { size: 300 });

  eq(root.children.map(c => c.name).sort(), ['第二中学', '芳草地小学'], '两所学校');
  const s = T.findByPath(root, ['芳草地小学']);
  eq(s.children.map(c => c.name).sort(), ['2026春课后服务', '2026秋项目'], '学校下两个项目');
  const p = T.findByPath(root, ['芳草地小学', '2026春课后服务']);
  eq(p.children.map(c => c.name).sort(), ['合同.pdf', '附件'], '项目下文件+子目录');
  const sub = T.findByPath(root, ['芳草地小学', '2026春课后服务', '附件']);
  eq(sub.children.length, 1, '深层子目录');
  eq(sub.children[0].name, '照片.jpg', '深层文件落位正确');
  eq(T.count(root).files, 4, '文件总数 4');
  eq(T.count(root).folders, 6, '文件夹数 6（2学校+3项目+1附件）');

  // 同名学校合并而非重复创建
  const before = root.children.length;
  T.insertByRelPath(root, '芳草地小学/2026春课后服务/第二份.pdf', { size: 100 });
  eq(root.children.length, before, '重复拖入同名学校不新建学校');
  eq(T.count(root).files, 5, '文件数增至 5');
}

console.log('=== 4. 重命名 ===');
{
  const root = T.createRoot();
  const s = T.addFolder(root, '学校A');
  eq(T.rename(root, s.id, '芳草地小学'), '芳草地小学', '重命名返回新名');
  eq(s.name, '芳草地小学', '节点已更新');
  T.addFolder(root, '学校B');
  const s2 = root.children[1];
  eq(T.rename(root, s2.id, '芳草地小学'), '芳草地小学 (2)', '重命名撞名自动加序号');
  throws(() => T.rename(root, s.id, '   '), '空名重命名抛错（UI 层负责拦截空输入）');
  eq(s.name, '芳草地小学', '抛错后原名未被破坏');
  eq(T.rename(root, s.id, '2026/暑期'), '2026 暑期', '重命名同样清洗非法字符');
  throws(() => T.rename(root, 'nonexistent', 'x'), '重命名不存在的节点抛错');
}

console.log('=== 5. 移动与环检测 ===');
{
  const root = T.createRoot();
  const a = T.addFolder(root, 'A');
  const b = T.addFolder(a, 'B');
  const c = T.addFolder(b, 'C');
  const x = T.addFolder(root, 'X');
  // 环检测必须在移动前验证：此时 C 仍在 A→B→C 链上
  throws(() => T.move(root, a.id, c.id), '移动到自身后代应抛错（防环）');
  throws(() => T.move(root, a.id, b.id), '移动到直接子级应抛错');
  throws(() => T.move(root, a.id, a.id), '移动到自身应抛错');
  throws(() => T.move(root, a.id, 'ghost'), '目标不存在应抛错');
  throws(() => T.move(root, 'ghost', x.id), '源不存在应抛错');
  T.move(root, c.id, x.id);
  eq(x.children.map(n => n.name), ['C'], '移动 C 到 X');
  eq(b.children.length, 0, 'B 下已空');
  T.move(root, x.id, a.id);
  eq(a.children.map(n => n.name), ['B', 'X'], 'X 整体移入 A（合法，非环）');
}

console.log('=== 6. 删除与 blob 回收 ===');
{
  const root = T.createRoot();
  T.insertByRelPath(root, '学校/项目/a.pdf', { blobKey: 'blob_1', size: 10 });
  T.insertByRelPath(root, '学校/项目/b.pdf', { blobKey: 'blob_2', size: 20 });
  const school = T.findByPath(root, ['学校']);
  const keys = T.collectBlobKeys(school);
  eq(keys.sort(), ['blob_1', 'blob_2'], '收集子树内所有 blobKey');
  const removed = T.remove(root, school.id);
  ok(removed && removed.name === '学校', '删除返回被删子树');
  eq(root.children.length, 0, '根下已空');
  eq(T.remove(root, 'ghost'), null, '删除不存在节点返回 null');
  eq(T.remove(root, 'root'), null, '不允许删除根');
}

console.log('=== 7. 序列化 / 反序列化 ===');
{
  const root = T.createRoot();
  T.insertByRelPath(root, '芳草地小学/项目一/合同.pdf', { size: 1234, blobKey: 'k1' });
  T.insertByRelPath(root, '第二中学/项目二/表.xlsx', { size: 5678, blobKey: 'k2' });
  const pkg = T.serialize(root);
  eq(pkg.format, 'jiaopei-vault', '导出包格式标识');
  eq(pkg.version, 1, '版本号');
  ok(typeof pkg.exportedAt === 'string', '含导出时间');
  const round = T.deserialize(JSON.parse(JSON.stringify(pkg)));
  eq(round.children.length, 2, '还原两所学校');
  eq(T.count(round).files, 2, '还原文件数');
  const f = T.findByPath(round, ['芳草地小学', '项目一', '合同.pdf']);
  ok(f && f.size === 1234, '文件属性保留');
  ok(f && f.blobKey === 'k1', 'blobKey 保留');
  eq(f.source, 'imported', '导入节点标记来源');
  throws(() => T.deserialize({ format: 'wrong' }), '非法包应抛错');
  throws(() => T.deserialize(null), 'null 包应抛错');
}

console.log('=== 8. 导入合并 ===');
{
  const target = T.createRoot();
  T.insertByRelPath(target, '芳草地小学/项目一/合同.pdf', { size: 1 });
  const incoming = T.createRoot();
  T.insertByRelPath(incoming, '芳草地小学/项目一/合同.pdf', { size: 1 });
  T.insertByRelPath(incoming, '芳草地小学/项目一/新文件.pdf', { size: 2 });
  T.insertByRelPath(incoming, '第三中学/项目三/x.pdf', { size: 3 });
  const stat = T.mergeInto(target, incoming);
  eq(stat.filesAdded, 2, '新增文件 2');
  eq(stat.filesSkipped, 1, '跳过同名文件 1');
  eq(stat.foldersAdded, 2, '新增文件夹 2（第三中学 + 项目三；项目一已存在被合并）');
  eq(target.children.length, 2, '合并后共 2 所学校');
  eq(T.count(target).files, 3, '合并后文件总数 3');
}

console.log('=== 9. 统计与展示辅助 ===');
{
  const root = T.createRoot();
  T.insertByRelPath(root, 'S/P/a.pdf', { size: 1024 });
  T.insertByRelPath(root, 'S/P/b.pdf', { size: 2048 });
  eq(T.count(root).bytes, 3072, '字节累计');
  eq(T.formatSize(0), '0 B', '0 字节');
  eq(T.formatSize(1023), '1023 B', 'B 级');
  eq(T.formatSize(1024), '1.0 KB', 'KB 级');
  eq(T.formatSize(1048576), '1.0 MB', 'MB 级');
  eq(T.formatSize(1073741824), '1.00 GB', 'GB 级');
  eq(T.extOf('a.b.PDF'), 'pdf', '扩展名小写化');
  eq(T.extOf('noext'), '', '无扩展名');
  eq(T.extOf('.gitignore'), '', '隐藏文件不算扩展名');
  eq(T.fileBadge('合同.pdf').label, 'PDF', 'PDF 徽标');
  eq(T.fileBadge('预算.xlsx').label, 'XLS', 'XLSX 徽标');
  eq(T.fileBadge('怪文件.xyz').label, 'XYZ', '未知扩展名回退');
  eq(T.fileBadge('无扩展名').label, 'FILE', '无扩展名回退');
}

console.log('=== 10. 边界与异常安全 ===');
{
  const root = T.createRoot();
  eq(T.insertByRelPath(root, '', { size: 1 }).name, '未命名文件', '空路径兜底');
  eq(T.insertByRelPath(root, '   ', { size: 1 }).name, '未命名文件', '纯空白路径兜底');
  eq(root.children.length, 1, '两次空路径兜底同名 → 去重后仅 1 个');
  const deep = T.createRoot();
  T.insertByRelPath(deep, 'a/b/c/d/e/f/g/h/i/j/file.txt', { size: 1 });
  eq(T.count(deep).folders, 10, '深层路径 10 层文件夹');
  eq(T.find(deep, 'root').node.id, 'root', 'find 能定位根');
  eq(T.find(deep, 'ghost'), null, 'find 不存在返回 null');
  eq(T.listSchools(deep).length, 1, 'listSchools 只返回第一层');
  // XSS 相关：名称保留原字符，转义交给渲染层
  eq(T.sanitizeName('<script>x</script>'), 'script x script', '尖括号与斜杠均被清洗');
  ok(!/[<>]/.test(T.sanitizeName('<img src=x onerror=1>')), '清洗后不含尖括号');
  eq(T.uniqueName({ children: [{ name: 'A' }, { name: 'A (2)' }] }, 'A'), 'A (3)', '连续重名递增');
}

console.log('\n' + '='.repeat(46));
if (fail === 0) {
  console.log(`✅ 全部通过：${pass} 项断言`);
} else {
  console.log(`❌ 失败 ${fail} 项 / 通过 ${pass} 项`);
  fails.forEach(f => console.log('  ✗ ' + f));
  process.exitCode = 1;
}
