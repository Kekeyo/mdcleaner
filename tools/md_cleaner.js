#!/usr/bin/env node
/*
 * md_cleaner —— 习题 / 教材 Markdown(KaTeX) 清洗工具 (命令行版；网页版见 清洗网页.html)
 *
 * 用法 (在终端里运行):
 *   node md_cleaner.js <输入.md>                  就地清洗，并先生成 <输入>.备份.md
 *   node md_cleaner.js <输入.md> -o <输出.md>     结果写到另一个文件，不动原文件
 *   node md_cleaner.js <输入.md> --check          只检查、出报告，不写文件
 *
 * 选项: --no-reorder 不重排小问 | --keep-noise 不删模型草稿 | --keep-tag 不改 \tag | --no-backup 不备份
 */
const fs = require('fs');
const path = require('path');
const { clean } = require('../web/cleaner_core.js');

const argv = process.argv.slice(2);
const flags = new Set(argv.filter(a => a.startsWith('--')));
const oi = argv.indexOf('-o');
const outPath = oi >= 0 ? argv[oi + 1] : null;
const input = argv.find((a, i) => !a.startsWith('-') && (oi < 0 || i !== oi + 1));
if (!input) { console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*\s?/gm, '').replace(/^ \* ?/gm, '')); process.exit(1); }

let katex = null;
try { katex = require('katex'); } catch (e) { /* 校验可选 */ }

const { result, report } = clean(fs.readFileSync(input, 'utf8'), {
  reorder: !flags.has('--no-reorder'), noise: !flags.has('--keep-noise'), tag: !flags.has('--keep-tag'), ids: flags.has('--heading-ids'),
}, katex);

if (!flags.has('--check')) {
  const target = outPath || input;
  if (!outPath && !flags.has('--no-backup')) {
    const ext = path.extname(input), base = input.slice(0, -ext.length);
    let bak = base + '.备份' + ext;
    if (fs.existsSync(bak)) bak = base + '.备份' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12) + ext;
    fs.copyFileSync(input, bak);
    report.notes.unshift('已备份原文件: ' + bak);
  }
  fs.writeFileSync(target, result);
  report.notes.unshift('已写入: ' + target);
}
console.log('\n=== 清洗报告 ===');
for (const [k, v] of Object.entries(report.fixed)) console.log(`  ${String(v).padStart(5)} 处  ${k}`);
if (!Object.keys(report.fixed).length) console.log('  (没有需要修复的地方)');
if (report.removed.length) { console.log(`\n删除的模型草稿 (${report.removed.length}):`); report.removed.forEach(x => console.log('  - ' + x)); }
if (report.unbalanced.length) { console.log(`\n⚠ $ 不配对，需要手工处理 (${report.unbalanced.length}):`); report.unbalanced.forEach(x => console.log('  - ' + x)); }
if (report.notes.length) { console.log('\n提示:'); report.notes.forEach(x => console.log('  - ' + x)); }
console.log(`\n清洗后仍存在的问题: ${report.remaining.length}${katex ? '' : '  (未安装 katex，跳过公式渲染校验: npm install katex)'}`);
report.remaining.slice(0, 50).forEach(x => console.log('  - ' + x));
process.exit(report.remaining.length || report.unbalanced.length ? 2 : 0);
