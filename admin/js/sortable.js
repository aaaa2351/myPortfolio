export function makeSortable(container, { itemSelector, orientation = 'vertical', onMove }) {
  let dragIndex = -1;
  const items = () => [...container.querySelectorAll(itemSelector)];

  function clearMarks() {
    container.querySelectorAll('.drop-before, .drop-after, .dragging').forEach((node) => {
      node.classList.remove('drop-before', 'drop-after', 'dragging');
    });
  }

  function isAfter(event, item) {
    const rect = item.getBoundingClientRect();
    return orientation === 'vertical'
      ? event.clientY > rect.top + rect.height / 2
      : event.clientX > rect.left + rect.width / 2;
  }

  container.addEventListener('dragstart', (event) => {
    const item = event.target.closest(itemSelector);
    if (!item || !container.contains(item)) return;
    dragIndex = items().indexOf(item);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(dragIndex));
    requestAnimationFrame(() => item.classList.add('dragging'));
  });

  container.addEventListener('dragover', (event) => {
    if (dragIndex < 0) return;
    const item = event.target.closest(itemSelector);
    if (!item) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    container.querySelectorAll('.drop-before, .drop-after').forEach((node) => node.classList.remove('drop-before', 'drop-after'));
    item.classList.add(isAfter(event, item) ? 'drop-after' : 'drop-before');
  });

  container.addEventListener('drop', (event) => {
    if (dragIndex < 0) return;
    const item = event.target.closest(itemSelector);
    if (!item) return;
    event.preventDefault();
    let target = items().indexOf(item) + (isAfter(event, item) ? 1 : 0);
    if (dragIndex < target) target -= 1;
    const from = dragIndex;
    dragIndex = -1;
    clearMarks();
    if (from !== target) onMove(from, target);
  });

  container.addEventListener('dragend', () => {
    dragIndex = -1;
    clearMarks();
  });
}

export function moveItem(list, from, to) {
  if (to < 0 || to >= list.length || from === to) return false;
  list.splice(to, 0, list.splice(from, 1)[0]);
  return true;
}
