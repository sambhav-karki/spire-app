const fs = require('node:fs');
const files = [
  'src/app/sound.service.ts',
  'src/app/game-logic.ts',
  'src/app/app.ts',
  'src/app/app.html',
  'src/app/app.css',
  'SKILL.md',
  'src/index.html',
  'src/styles.css',
];
const fence = String.fromCharCode(96).repeat(3);
const languages = { ts: 'typescript', html: 'html', css: 'css', md: 'markdown' };
const output = [
  '# WebSlayer Spire dynamic music and pixel donut background: complete sources',
  '',
  'Includes the four requested files, plus the existing domain rules, architecture documentation, font entry point and shared pixel stylesheet required by the implementation.',
  '',
];
for (const file of files) {
  const source = fs
    .readFileSync(file, 'utf8')
    .replace(/^\uFEFF/, '')
    .trimEnd();
  if (/\uFFFD/.test(source)) throw new Error(`Invalid encoding in ${file}`);
  output.push(`## ${file}`, '', fence + languages[file.split('.').pop()], source, fence, '');
}
fs.writeFileSync('artifacts/donut-music-source.md', output.join('\n'));
const skill = fs.readFileSync('SKILL.md', 'utf8');
if (
  !/^---\r?\nname: [a-z0-9-]+\r?\ndescription: [^\r\n]+(?:\r?\n[ \t]+[^\r\n]+)*\r?\n---/.test(
    skill,
  ) ||
  /\[TODO:/.test(skill)
)
  throw new Error('Invalid skill frontmatter or placeholder');
console.log('Complete source bundle written; encoding and skill frontmatter checks passed.');
