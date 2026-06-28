import { useState, type FormEvent } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { useTranslation } from 'react-i18next';
import { useEscapeKey } from '../hooks/useEscapeKey.ts';

/**
 * Minimal rich-text editor for Bacheca messages. Emits HTML on every change;
 * the server re-sanitizes against a strict allowlist (sanitizeBulletinHtml), so
 * this is purely an authoring affordance, never the security boundary. Scope is
 * "text + links": bold/italic, lists, a heading level, and safe links.
 *
 * Link insertion uses an in-app modal (not window.prompt) so it matches the rest
 * of the app and never shows a browser "app.sonoqui.pro says" chrome dialog.
 */
export function RichTextEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}) {
  const { t } = useTranslation(['bacheca', 'common']);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState('https://');

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [3] },
        // Drop block types outside the text+links scope.
        codeBlock: false,
        horizontalRule: false,
        blockquote: false,
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
    ],
    content: value || '',
    onUpdate: ({ editor: ed }) => onChange(ed.getHTML()),
  });

  if (!editor) return null;

  function openLinkDialog() {
    const prev = editor!.getAttributes('link').href as string | undefined;
    setLinkDraft(prev && prev.length > 0 ? prev : 'https://');
    setLinkOpen(true);
  }

  function applyLink(url: string) {
    const v = url.trim();
    if (v === '' || v === 'https://') {
      editor!.chain().focus().extendMarkRange('link').unsetLink().run();
    } else {
      editor!.chain().focus().extendMarkRange('link').setLink({ href: v }).run();
    }
    setLinkOpen(false);
  }

  function removeLink() {
    editor!.chain().focus().extendMarkRange('link').unsetLink().run();
    setLinkOpen(false);
  }

  return (
    <div className="rte">
      <Toolbar editor={editor} t={t} onLink={openLinkDialog} />
      <EditorContent editor={editor} className="rte-content" data-placeholder={placeholder} />
      {linkOpen && (
        <LinkDialog
          value={linkDraft}
          onChange={setLinkDraft}
          isEditing={editor.isActive('link')}
          onSubmit={applyLink}
          onRemove={removeLink}
          onCancel={() => setLinkOpen(false)}
        />
      )}
    </div>
  );
}

function Toolbar({
  editor,
  t,
  onLink,
}: {
  editor: Editor;
  t: (k: string) => string;
  onLink: () => void;
}) {
  return (
    <div className="rte-toolbar" role="toolbar">
      <RteBtn active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title={t('editor.bold')} label="B" bold />
      <RteBtn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title={t('editor.italic')} label="I" italic />
      <RteBtn active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title={t('editor.heading')} label="H" />
      <span className="rte-sep" />
      <RteBtn active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title={t('editor.bulletList')} label="• —" />
      <RteBtn active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title={t('editor.orderedList')} label="1." />
      <span className="rte-sep" />
      <RteBtn active={editor.isActive('link')} onClick={onLink} title={t('editor.link')} label="🔗" />
    </div>
  );
}

function LinkDialog({
  value,
  onChange,
  isEditing,
  onSubmit,
  onRemove,
  onCancel,
}: {
  value: string;
  onChange: (v: string) => void;
  isEditing: boolean;
  onSubmit: (url: string) => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation(['bacheca', 'common']);
  useEscapeKey(onCancel);

  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit(value);
  }

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50" onClick={onCancel}>
      <form
        className="card w-full max-w-md space-y-3"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 className="section-title">{t('editor.linkTitle')}</h2>
        <div>
          <label className="label">{t('editor.linkPrompt')}</label>
          <input
            className="input"
            type="url"
            inputMode="url"
            placeholder="https://…"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            autoFocus
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <div>
            {isEditing && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove} style={{ color: 'var(--color-error)' }}>
                {t('editor.unlink')}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary" onClick={onCancel}>
              {t('common:btn.cancel')}
            </button>
            <button type="submit" className="btn btn-primary">
              {t('common:btn.confirm')}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function RteBtn({
  active,
  onClick,
  title,
  label,
  bold,
  italic,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  label: string;
  bold?: boolean;
  italic?: boolean;
}) {
  return (
    <button
      type="button"
      className={`rte-btn ${active ? 'rte-btn-active' : ''}`}
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      style={{ fontWeight: bold ? 700 : undefined, fontStyle: italic ? 'italic' : undefined }}
    >
      {label}
    </button>
  );
}
