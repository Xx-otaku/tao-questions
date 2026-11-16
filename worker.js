import {mergeRows, signature, validTarget} from './model.js';

const key = 'task';
const alarm = 'collection-tick';
const get = async () => (await chrome.storage.local.get(key))[key];
const save = task => chrome.storage.local.set({[key]:task});
const pause = (task, reason) => {task.status = 'paused'; task.reason = reason;};
const done = (task, reason) => {task.status = 'done'; task.reason = reason;};
const waitLimit = 15;
let queue = Promise.resolve();
let timer;

function serial(operation) {
  const result = queue.then(operation);
  queue = result.catch(error => console.error(error));
  return result;
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => serial(tick), 800);
  // A delayed wake-up also covers suspension of the extension service worker.
  chrome.alarms.create(alarm, {delayInMinutes:1});
}

async function inspect(tabId, step, scroll = false, expectedItem) {
  const tab = await chrome.tabs.get(tabId);
  const url = new URL(tab.url || 'about:blank');
  const host = url.hostname;
  const allowed = step === 'search' || step === 'next'
    ? ['s.taobao.com'] : ['item.taobao.com','detail.tmall.com'];
  if (tab.status === 'loading' && !allowed.includes(host)) return {waiting:true};
  if (!allowed.includes(host)) return {error:'标签页已离开目标页面。请检查是否需要登录或验证。'};
  if (expectedItem && url.searchParams.get('id') !== expectedItem) {
    return tab.status === 'loading' ? {waiting:true} : {error:'当前标签页的商品已变化，请重新打开原商品。'};
  }
  await chrome.scripting.executeScript({target:{tabId}, files:['page.js']});
  const [frame] = await chrome.scripting.executeScript({
    target:{tabId}, func:async (action, move) => {
      const pageUrl = location.href;
      return {...await globalThis.inspectTaobao(action, move), pageUrl};
    }, args:[step, scroll]
  });
  if (expectedItem && frame.result?.rows) {
    const current = new URL(frame.result.pageUrl || tab.url);
    if (current.protocol !== 'https:' || !allowed.includes(current.hostname) ||
        current.pathname !== '/item.htm' || current.searchParams.get('id') !== expectedItem) {
      return {error:'当前页面与采集商品不一致，请检查商品详情。'};
    }
    frame.result.source = {productId:expectedItem, title:frame.result.productTitle, titleChecked:3,
      url:current.origin + '/item.htm?id=' + expectedItem};
  }
  return frame.result;
}

function wait(task, message) {
  if (++task.waits >= waitLimit) pause(task, message);
}

function finishProduct(task, skipped) {
  task.seen.push(task.item.id);
  if (skipped) task.noQuestions++;
  task.item = null;
  task.rows = [];
  task.offset = 0;
  task.waits = 0;
  task.bottomChecks = 0;
  task.phase = 'search';
}

async function tick() {
  const task = await get();
  if (task?.status !== 'running') return;
  try {
    await advance(task);
  } catch (error) {
    pause(task, '页面操作中断。请检查标签页后继续。');
    console.warn(error);
  }
  try {
    await save(task);
  } catch (error) {
    const saved = await get();
    pause(saved, '保存进度失败，请先复制已经保存的问题。');
    await save(saved);
    throw error;
  }
  if (task.status === 'running') schedule();
}

async function advance(task) {
  if (['search', 'flipping'].includes(task.phase)) {
    const result = await inspect(task.searchTab, 'search', task.phase === 'search');
    if (result.error) return pause(task, result.error);
    if (!result.ready || !result.products?.length) return wait(task, '未能读取搜索商品，请检查搜索页。');
    const ids = signature(result.products);
    if (task.phase === 'flipping') {
      if (ids === task.pageSignature) return wait(task, '没有确认翻页成功，请检查搜索页。');
      task.phase = 'search';
      task.waits = 0;
    }
    if (!result.sorted && !task.sortConfirmed) {
      task.needsSort = true;
      return pause(task, '请查看搜索页，确认已按销量排序。');
    }
    task.pageSignature = ids;
    task.searchUrl = (await chrome.tabs.get(task.searchTab)).url;
    const product = result.products.find(item => !task.seen.includes(item.id) && !task.excluded?.includes(item.id));
    if (!product) {
      if (result.last) return done(task, '搜索结果已读完，未达到目标。');
      if (!result.next) return wait(task, '找不到可确认的下一页按钮，请检查搜索结果。');
      // Save pending navigation before changing the page.
      task.phase = 'flipping';
      task.waits = 0;
      task.sortConfirmed = false;
      await save(task);
      const next = await inspect(task.searchTab, 'next');
      if (next.error) {
        task.phase = 'search';
        pause(task, next.error);
      }
      return;
    }
    task.item = product;
    task.phase = 'navigate';
    task.waits = 0;
    return;
  }

  if (task.phase === 'navigate') {
    if (task.productTab) {
      try {
        await chrome.tabs.update(task.productTab, {url:task.item.url, active:true});
      } catch {
        task.productTab = null;
      }
    }
    if (!task.productTab) {
      const source = await chrome.tabs.get(task.searchTab);
      task.productTab = (await chrome.tabs.create({url:'about:blank', active:true, windowId:source.windowId})).id;
      return;
    }
    task.phase = 'product';
    return;
  }

  const result = await inspect(task.productTab, task.phase, true, task.item.id);
  if (result.error) return pause(task, result.error);
  if (result.opening) {
    task.phase = 'questions';
    task.waits = 0;
    return;
  }
  if (result.rows) {
    task.phase = 'questions';
    const rows = mergeRows(task.rows, result.rows);
    if (!rows) return wait(task, '无法核对已读问答的位置，请检查问答面板。');
    const source = result.source;
    if (source.title) {
      task.questions = task.questions.map(row => row.productId === source.productId &&
        (row.titleChecked !== 3 || row.title !== source.title) ? {...row, ...source} : row);
    }
    const savedSource = task.questions.find(row => row.productId === source.productId && row.titleChecked === 3 && row.title);
    const offset = task.offset ?? task.rows.length;
    const added = rows.slice(offset, offset + task.target - task.questions.length);
    task.questions.push(...added.map(row => ({text:row.text, ...source, title:source.title || savedSource?.title || ''})));
    task.rows = rows;
    task.offset = offset + added.length;
    if (task.offset === rows.length && (result.end ||
        (result.total !== null && rows.length >= result.total))) finishProduct(task, false);
    if (task.questions.length === task.target) return done(task, '已达到目标。');
    if (task.phase === 'search') return;
    // The count in the header may include questions absent from the visible list.
    task.bottomChecks = !added.length && rows.length && result.bottom && !result.loading
      ? (task.bottomChecks || 0) + 1 : 0;
    if (task.bottomChecks >= 6) return finishProduct(task, false);
    if (added.length) task.waits = 0;
    else wait(task, '无法确认问答已经读完，请检查问答列表。');
    return;
  }
  if (result.scrollMoved) task.waits = 0;
  if (result.missing && result.bottom && result.complete) {
    if (++task.emptyChecks >= 3) {
      task.emptyChecks = 0;
      return finishProduct(task, true);
    }
  } else task.emptyChecks = 0;
  wait(task, '无法读取问答区域，请检查商品详情页。');
}

chrome.runtime.onInstalled.addListener(() => chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}));
chrome.runtime.onStartup.addListener(() => serial(async () => {
  const task = await get();
  if (task?.status === 'running') {
    pause(task, '浏览器已重启，请手动恢复。');
    task.interrupted = true;
    await save(task);
  }
}));
chrome.runtime.onInstalled.addListener(() => serial(async () => {
  const task = await get();
  if (task?.status === 'running') {
    pause(task, '扩展已重载，请手动恢复。');
    task.interrupted = true;
    await save(task);
  }
}));
chrome.alarms.onAlarm.addListener(event => {if (event.name === alarm) serial(tick);});
chrome.tabs.onRemoved.addListener(tabId => serial(async () => {
  const task = await get();
  if (task?.status === 'running' && [task.productTab, task.searchTab].includes(tabId)) {
    pause(task, '采集标签页已关闭，请手动恢复。');
    task.interrupted = true;
    await save(task);
  }
}));

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.url !== chrome.runtime.getURL('panel.html')) return;
  serial(async () => {
    let task = await get();
    if (message.action === 'start') {
      if (task?.status === 'running') throw Error('正在采集，请先暂停或停止。');
      if (task?.questions.length && !message.replace) throw Error('请确认清空已有结果。');
      if (!validTarget(message.target)) throw Error('目标请输入正整数。');
      const tab = await chrome.tabs.get(message.tabId);
      if (!tab.url?.startsWith('https://s.taobao.com/')) throw Error('请在淘宝搜索结果页开始。');
      const productTab = task?.productTab;
      let reusable;
      if (productTab && productTab !== tab.id) {
        try {
          const old = await chrome.tabs.get(productTab);
          if (old.windowId === tab.windowId &&
            /^https:\/\/(item\.taobao\.com|detail\.tmall\.com)\//.test(old.url || '')) reusable = old.id;
        } catch {}
      }
      task = {status:'running', reason:'', phase:'search', searchTab:tab.id, productTab:reusable,
        searchUrl:tab.url, target:message.target, questions:[], seen:[], excluded:[], rows:[], offset:0, noQuestions:0, waits:0, emptyChecks:0};
    } else if (!task) throw Error('请先开始采集。');
    else if (message.action === 'pause' && task.status === 'running') pause(task, '已手动暂停。');
    else if (message.action === 'stop' && task.status !== 'done') done(task, '已手动停止。');
    else if (message.action === 'delete-product') {
      const id = message.productId;
      if (typeof id !== 'string' || !task.questions.some(row => row.productId === id)) {
        throw Error('该商品已不在结果中。');
      }
      task.questions = task.questions.filter(row => row.productId !== id);
      task.excluded = [...new Set([...(task.excluded || []), id])];
      if (task.item?.id === id) finishProduct(task, false);
      task.refill = true;
      pause(task, '已删除该商品的问题。可手动继续补采。');
    }
    else if (message.action === 'resume' && task.status === 'paused') {
      if (task.needsSort && !message.sorted) throw Error('请先确认销量排序。');
      if (task.needsSort) task.sortConfirmed = true;
      task.needsSort = false;
      if (task.interrupted || task.refill) {
        let current;
        const tabs = await chrome.tabs.query({url:'https://s.taobao.com/*'});
        const original = tabs.find(tab => tab.id === task.searchTab && tab.url === task.searchUrl);
        const matches = tabs.filter(tab => tab.url === task.searchUrl);
        const candidate = original || (matches.length === 1 ? matches[0] : null);
        try { if (candidate) current = await inspect(candidate.id, 'search'); } catch {}
        if (!current?.products?.length || (task.pageSignature && signature(current.products) !== task.pageSignature)) {
          task.status = task.refill ? 'paused' : 'restart';
          task.reason = '无法确认原位置。可先复制已有结果，再打开搜索结果页重新开始。';
          await save(task);
          return;
        }
        task.searchTab = candidate.id;
        let currentProduct;
        try { currentProduct = await chrome.tabs.get(task.productTab); } catch {}
        if (task.interrupted || (task.item && currentProduct?.url !== task.item.url &&
            new URL(currentProduct?.url || 'about:blank').searchParams.get('id') !== task.item.id)) {
          if (task.item) task.phase = 'navigate';
          if (task.interrupted) task.productTab = undefined;
        }
        task.interrupted = false;
      }
      task.waits = 0;
      task.emptyChecks = 0;
      task.bottomChecks = 0;
      task.refill = false;
      task.status = 'running';
      task.reason = '';
    } else throw Error('当前任务无法执行该操作。');
    if (task.status === 'running') await chrome.alarms.create(alarm, {delayInMinutes:1});
    await save(task);
    if (task.status === 'running') schedule();
  }).then(() => reply({ok:true}), error => reply({error:error.message}));
  return true;
});
