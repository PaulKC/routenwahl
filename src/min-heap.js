// Binary min-heap of (priority, cell) pairs.
export function createMinHeap() {
  const priorities = [];
  const cells = [];
  const swap = (i, j) => {
    [priorities[i], priorities[j]] = [priorities[j], priorities[i]];
    [cells[i], cells[j]] = [cells[j], cells[i]];
  };
  return {
    size: () => cells.length,
    push(priority, cell) {
      priorities.push(priority);
      cells.push(cell);
      for (let i = cells.length - 1; i > 0;) {
        const parent = (i - 1) >> 1;
        if (priorities[parent] <= priorities[i]) break;
        swap(i, parent);
        i = parent;
      }
    },
    pop() {
      const top = cells[0];
      const lastPriority = priorities.pop();
      const lastCell = cells.pop();
      if (cells.length) {
        priorities[0] = lastPriority;
        cells[0] = lastCell;
        for (let i = 0; ;) {
          const left = 2 * i + 1;
          const right = left + 1;
          let smallest = i;
          if (left < cells.length && priorities[left] < priorities[smallest]) smallest = left;
          if (right < cells.length && priorities[right] < priorities[smallest]) smallest = right;
          if (smallest === i) break;
          swap(i, smallest);
          i = smallest;
        }
      }
      return top;
    },
  };
}
