const fs = require('fs');
const path = require('path');

const inputFile = path.join(__dirname, '..', 'data', 'post-full.json');

const outputFile = path.join(__dirname, '..', 'data', 'post-allocation.json');

const posts = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

const targets = {
  joy: 300,
  neutral: 200,
  sadness: 200,
  disgust: 100,
  fear: 100,
  anger: 100,
  surprise: 100,
};

const grouped = {};

for (const post of posts) {
  const label = post?.emotionFeature?.label;

  if (!label) continue;

  if (!grouped[label]) {
    grouped[label] = [];
  }

  grouped[label].push(post);
}

const selected = [];

for (const [label, target] of Object.entries(targets)) {
  const items = grouped[label] ?? [];

  // random để tránh luôn lấy các bài đầu tiên
  const shuffled = [...items].sort(() => Math.random() - 0.5);

  const count = Math.min(target, shuffled.length);

  selected.push(...shuffled.slice(0, count));

  console.log(`${label}: lấy ${count}/${target} (hiện có ${items.length})`);
}

// trộn lại toàn bộ output
selected.sort(() => Math.random() - 0.5);

fs.writeFileSync(outputFile, JSON.stringify(selected, null, 2), 'utf8');

console.log(`✅ Saved ${selected.length} posts to ${outputFile}`);
