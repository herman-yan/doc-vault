const fs = require('fs'), vm = require('vm'), path = require('path');

function check(file) {
  const html = fs.readFileSync(file, 'utf8');
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m, i = 0, bad = 0;
  while ((m = re.exec(html))) {
    i++;
    const code = m[1];
    if (!code.trim()) continue;
    const line = html.slice(0, m.index).split('\n').length;
    try {
      new vm.Script(code, { filename: file + ':inline#' + i + '@line' + line });
    } catch (e) {
      bad++;
      console.log('SYNTAX ERROR in ' + path.basename(file) + ' inline#' + i + ' (html line ' + line + '): ' + e.message);
      const ln = (e.stack.match(/inline#\d+@line\d+:(\d+)/) || [])[1];
      if (ln) {
        const src = code.split('\n');
        console.log('   > ' + (src[ln - 1] || '').trim().slice(0, 120));
      }
    }
  }
  console.log((bad ? 'FAIL' : 'OK  ') + ' ' + file + '  (inline blocks checked: ' + i + ')');
  return bad;
}

let fail = 0;
process.argv.slice(2).forEach(f => { fail += check(f); });
process.exit(fail ? 1 : 0);
