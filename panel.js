import {plainText, questionText} from './model.js';
const byId = id => document.getElementById(id);
const target = byId('target');
const primary = byId('primary');
const stop = byId('stop');
const copy = byId('copy');
const list = byId('questions');
const message = byId('message');
let task;
let rendered = [];
const groups = new Map();
let busy = false;
let copyTimer;

function render(next) {
  task = next;
  const status = next?.status;
  const questions = next?.questions || [];
  target.disabled = ['running','paused'].includes(status);
  if (target.disabled) target.value = next.target;
  copy.disabled = !questions.length;
  byId('new-task').hidden = !next?.refill;
  stop.hidden = !['running','paused'].includes(status);
  primary.textContent = {running:'暂停',paused:next?.needsSort ? '确认销量排序' : next?.refill ? '继续补采' : '继续',restart:'重新开始'}[status] || '开始';
  byId('status').textContent = {running:'正在采集',paused:'已暂停',done:'已结束',restart:'需要重新开始'}[status] || '等待开始';
  const total = next?.target || Number(target.value) || 100;
  byId('count').textContent = questions.length + ' / ' + total;
  byId('progress').max = total;
  byId('progress').value = questions.length;
  byId('stats').hidden = !next;
  if (next) byId('stats').textContent = '已处理 ' + next.seen.length + ' 件 · 无问答跳过 ' + next.noQuestions + ' 件';
  message.textContent = next?.reason || (!next ? '请在淘宝搜索结果页按销量排序后开始。' : '');
  message.hidden = !message.textContent;
  byId('empty').hidden = questions.length > 0;
  if (rendered.some((row,index) => JSON.stringify(questions[index]) !== JSON.stringify(row))) {
    list.replaceChildren();
    groups.clear();
    rendered = [];
  }
  for (const question of questions.slice(rendered.length)) {
    const id = question.productId || '';
    if (!groups.has(id)) {
      const section = document.createElement('section');
      const header = document.createElement('div');
      header.className = 'group-heading';
      const heading = document.createElement('h2');
      const title = !id ? '旧版记录 · 无来源' : question.titleChecked !== 3
        ? '商品标题待核实' : question.title || '商品标题未获取';
      if (id && /^https:\/\/(item\.taobao\.com|detail\.tmall\.com)\/item\.htm\?id=\d+$/.test(question.url)) {
        const link = document.createElement('a');
        link.href = question.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = title;
        heading.append(link);
      } else heading.textContent = title;
      header.append(heading);
      if (id) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'delete-product';
        remove.textContent = '删除本商品问题';
        remove.addEventListener('click', () => {
          const count = task.questions.filter(row => row.productId === id).length;
          if (count && confirm('删除「' + title + '」的全部 ' + count + ' 条问题？')) {
            send({action:'delete-product',productId:id});
          }
        });
        header.append(remove);
      }
      const rows = document.createElement('ol');
      section.append(header, rows);
      list.append(section);
      groups.set(id, rows);
    }
    const row = document.createElement('li');
    row.textContent = questionText(question);
    groups.get(id).append(row);
  }
  rendered = questions;
}

async function send(payload) {
  if (busy) return;
  busy = true;
  try {
    const response = await chrome.runtime.sendMessage(payload);
    if (!response?.ok) throw Error(response?.error || '未收到扩展响应，请重试。');
  } catch (error) {
    message.hidden = false;
    message.textContent = error.message;
  } finally { busy = false; }
}

byId('controls').addEventListener('submit', async event => {
  event.preventDefault();
  if (task?.status === 'running') return send({action:'pause'});
  if (task?.status === 'paused') return send({action:'resume',sorted:task.needsSort});
  return startNew();
});
async function startNew(quantity = target.valueAsNumber) {
  const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
  if (task?.questions.length && !confirm('开始新采集会清空已有问题。确定继续吗？')) return;
  return send({action:'start',target:quantity,tabId:tab?.id,replace:Boolean(task?.questions.length)});
}
byId('new-task').addEventListener('click', () => {
  const value = prompt('输入新任务的目标条数', target.value);
  if (value === null) return;
  startNew(Number(value));
});
stop.addEventListener('click', () => send({action:'stop'}));
target.addEventListener('input', () => { if (!task) render(); });
copy.addEventListener('click', async () => {
  const questions = task.questions;
  try {
    await navigator.clipboard.writeText(plainText(questions));
    copy.textContent = '已复制 ' + questions.length + ' 条';
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {copy.textContent = '一键复制';}, 1800);
  } catch {
    message.hidden = false;
    message.textContent = '复制失败，请重试。';
  }
});
const initial = await chrome.storage.local.get('task');
render(initial.task);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.task) render(changes.task.newValue);
});
