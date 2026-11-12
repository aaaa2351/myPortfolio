import { getPath, setPath } from '../dom.js';
import { store, update } from '../state.js';
import { textField, switchField } from '../ui.js';
import { imageField } from '../picker.js';

export function boundText(path, options) {
  return textField({
    ...options,
    value: getPath(store.draft, path) ?? '',
    onInput(value) {
      update((draft) => setPath(draft, path, value.trim()));
      if (options.onInput) options.onInput(value);
    }
  });
}

export function boundImage(path, options) {
  return imageField({
    ...options,
    value: getPath(store.draft, path) || '',
    onChange: (value) => update((draft) => setPath(draft, path, value))
  });
}

export function boundSwitch(path, options) {
  return switchField({
    ...options,
    checked: Boolean(getPath(store.draft, path)),
    onChange: (checked) => update((draft) => setPath(draft, path, checked))
  });
}
