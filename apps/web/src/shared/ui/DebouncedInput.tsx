// A text filter that waits for the typist to STOP before it asks the server anything.
//
// `SearchInput` already debounces, and this is not a replacement for it: that control carries a
// search icon and a clear button, which cost 72px of gutter and are worth it in a bar with room.
// A row of eleven filters has no such room, so this is the same TIMING wrapped around the plain
// `Input` the rest of that bar uses.
//
// The pause is the whole point, and it is a correctness fix rather than a performance one. A filter
// that queried on every keystroke sent «ا», «اخ», «اخر»… as separate questions, and the early ones
// are the WIDE ones: on a real payroll a one-letter prefix matches thousands, which is how a screen
// whose filter is capped ends up reporting «narrow your filter» and showing nothing for a term that
// matches exactly one person. The answers also arrive out of order, so the last one rendered was
// not necessarily the last one asked.
import { useEffect, useState, type ComponentProps } from 'react';
import { Input } from './form';

export const DebouncedInput = ({
  value,
  onValueChange,
  debounceMs = 350,
  ...rest
}: Omit<ComponentProps<typeof Input>, 'value' | 'onChange'> & {
  value: string;
  onValueChange: (value: string) => void;
  debounceMs?: number;
}): JSX.Element => {
  const [text, setText] = useState(value);

  // An external change — «clear filters», a restored URL, the back button — replaces what is in
  // the box. Without this the box would keep showing a term the list is no longer filtered by.
  useEffect(() => {
    setText(value);
  }, [value]);

  // Emit only what the USER changed, exactly as `SearchInput` does and for the same reason: the
  // caller passes an inline `onValueChange`, so its identity changes on every parent render and
  // this effect re-runs constantly. Without the guard it would re-emit the unchanged term and
  // reset the page the reader had navigated to.
  useEffect(() => {
    if (text === value) return;
    const id = window.setTimeout(() => onValueChange(text), debounceMs);
    return () => window.clearTimeout(id);
  }, [text, value, debounceMs, onValueChange]);

  return <Input {...rest} value={text} onChange={(e) => setText(e.target.value)} />;
};
