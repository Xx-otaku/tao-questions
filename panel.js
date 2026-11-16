import {plainText} from './model.js';
const byId = id => document.getElementById(id);
const target = byId('target');
const primary = byId('primary');
const stop = byId('stop');
const copy = byId('copy');
const list = byId('questions');
const message = byId('message');
let task;
let rendered = [];
let busy = false;
let copyTimer;

function render(next) {
  task = next;
  const status = next?.status;
  const questions = next?.questions || [];
  target.disabled = ['running','paused'].includes(status);
  if (target.disabled) target.value = next.target;
  copy.disabled = !questions.length;
  stop.hidden = !['running','paused'].includes(status);
  primary.textContent = {running:'暂停',paused:next?.needsSort ? '确认销量排序' : '继续',restart:'重新开始'}[status] || '开始';
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
  if (list.dataset.count > questions.length || rendered.some((text,index) => questions[index] !== text)) {
    list.replaceChildren();
  }
  for (const text of questions.slice(list.childElementCount)) {
    const row = document.createElement('li');
    row.textContent = text;
    list.append(row);
  }
  rendered = questions;
  list.dataset.count = questions.length;
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
  const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
  if (task?.questions.length && !confirm('开始新采集会清空已有问题。确定继续吗？')) return;
  return send({action:'start',target:target.valueAsNumber,tabId:tab?.id,replace:Boolean(task?.questions.length)});
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
