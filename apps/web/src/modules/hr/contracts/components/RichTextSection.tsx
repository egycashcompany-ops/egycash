// D7 — the TipTap section editor. The toolbar exposes ONLY what the server-side
// sanitizer accepts (p/h1-h4/strong/em/u/s/ul/ol/li/blockquote/hr/table + text-align),
// so nothing an author produces here is stripped on save. Variables are plain
// `{{key}}` text — the parent inserts them at the caret via the exposed editor.
import { useEffect } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import { useT } from '../../../../platform/localization/useT';
import { cn } from '../../../../shared/lib/cn';

const ToolButton = ({
  active = false,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  label: string;
  onClick: () => void;
  children: string;
}): JSX.Element => (
  <button
    type="button"
    title={label}
    aria-label={label}
    onMouseDown={(e) => e.preventDefault()}
    onClick={onClick}
    className={cn(
      'min-w-8 rounded px-1.5 py-1 text-xs font-semibold',
      active
        ? 'bg-brand-600 text-white'
        : 'text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700',
    )}
  >
    {children}
  </button>
);

const Divider = (): JSX.Element => <span className="mx-1 h-5 w-px bg-slate-300 dark:bg-slate-600" />;

export const RichTextSection = ({
  value,
  onChange,
  dir,
  minHeightClass = 'min-h-40',
  onEditorFocus,
  disabled = false,
}: {
  value: string;
  onChange: (html: string) => void;
  dir: 'rtl' | 'ltr';
  minHeightClass?: string;
  /** The parent tracks the focused editor so the variable browser inserts at its caret. */
  onEditorFocus?: (editor: Editor) => void;
  disabled?: boolean;
}): JSX.Element => {
  const t = useT();
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
        code: false,
        codeBlock: false,
      }),
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
    ],
    content: value,
    editable: !disabled,
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
    onFocus: ({ editor: e }) => onEditorFocus?.(e),
    editorProps: {
      attributes: {
        dir,
        class: cn('contract-editor px-3 py-2 text-sm focus:outline-none', minHeightClass),
      },
    },
  });

  // Async loads (edit page): sync external value into an already-mounted editor.
  useEffect(() => {
    if (editor !== null && !editor.isDestroyed && value !== editor.getHTML()) {
      editor.commands.setContent(value, false);
    }
  }, [value, editor]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  if (editor === null) return <div className={minHeightClass} />;

  return (
    <div className="overflow-hidden rounded-lg border border-slate-300 focus-within:border-brand-500 dark:border-slate-600">
      {!disabled && (
        <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-slate-50 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-800/60">
          <ToolButton label={t('contracts.editor.bold')} active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>B</ToolButton>
          <ToolButton label={t('contracts.editor.italic')} active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>I</ToolButton>
          <ToolButton label={t('contracts.editor.underline')} active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}>U</ToolButton>
          <ToolButton label={t('contracts.editor.strike')} active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}>S</ToolButton>
          <Divider />
          {([1, 2, 3] as const).map((level) => (
            <ToolButton
              key={level}
              label={t('contracts.editor.heading', { level })}
              active={editor.isActive('heading', { level })}
              onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
            >
              {`H${level}`}
            </ToolButton>
          ))}
          <Divider />
          <ToolButton label={t('contracts.editor.bulletList')} active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>•≡</ToolButton>
          <ToolButton label={t('contracts.editor.orderedList')} active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1≡</ToolButton>
          <ToolButton label={t('contracts.editor.blockquote')} active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>❝</ToolButton>
          <ToolButton label={t('contracts.editor.hr')} onClick={() => editor.chain().focus().setHorizontalRule().run()}>—</ToolButton>
          <Divider />
          <ToolButton label={t('contracts.editor.alignStart')} active={editor.isActive({ textAlign: dir === 'rtl' ? 'right' : 'left' })} onClick={() => editor.chain().focus().setTextAlign(dir === 'rtl' ? 'right' : 'left').run()}>⟛</ToolButton>
          <ToolButton label={t('contracts.editor.alignCenter')} active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()}>⟺</ToolButton>
          <ToolButton label={t('contracts.editor.alignJustify')} active={editor.isActive({ textAlign: 'justify' })} onClick={() => editor.chain().focus().setTextAlign('justify').run()}>☰</ToolButton>
          <Divider />
          <ToolButton label={t('contracts.editor.tableInsert')} onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>⊞</ToolButton>
          {editor.isActive('table') && (
            <>
              <ToolButton label={t('contracts.editor.tableRow')} onClick={() => editor.chain().focus().addRowAfter().run()}>+R</ToolButton>
              <ToolButton label={t('contracts.editor.tableCol')} onClick={() => editor.chain().focus().addColumnAfter().run()}>+C</ToolButton>
              <ToolButton label={t('contracts.editor.tableDelete')} onClick={() => editor.chain().focus().deleteTable().run()}>⊟</ToolButton>
            </>
          )}
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
};
