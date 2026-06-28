import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import { useTranslation } from 'react-i18next';
import { useEscapeKey } from '../hooks/useEscapeKey.ts';

/**
 * Standard rich-text editor for Bacheca messages. Emits HTML on every change;
 * the server re-sanitizes against a strict allowlist (sanitizeBulletinHtml), so
 * this is purely an authoring affordance, never the security boundary.
 *
 * The toolbar mirrors the SERVER allowlist exactly (text marks incl. underline /
 * strike / inline code, H1–H3, paragraph, bullet/ordered lists, blockquote,
 * safe links) so nothing the user formats is silently stripped on save. Link
 * insertion uses an in-app modal (never window.prompt). Reusable: pair with
 * `.bacheca-content` (web) / BulletinHtml (mobile) to render the same output.
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
        heading: { levels: [1, 2, 3] },
        // hr is not in the server allowlist — drop it so it can't be authored
        // then silently stripped. blockquote / codeBlock / inline code stay on.
        horizontalRule: false,
      }),
      Underline,
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
      <RteBtn onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title={t('editor.undo')} label="↺" />
      <RteBtn onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title={t('editor.redo')} label="↻" />
      <span className="rte-sep" />

      <RteBtn active={editor.isActive('paragraph') && !editor.isActive('heading')} onClick={() => editor.chain().focus().setParagraph().run()} title={t('editor.paragraph')} label="¶" />
      <RteBtn active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title={t('editor.h1')} label="H1" />
      <RteBtn active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title={t('editor.h2')} label="H2" />
      <RteBtn active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title={t('editor.h3')} label="H3" />
      <span className="rte-sep" />

      <RteBtn active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title={t('editor.bold')} label="B" bold />
      <RteBtn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title={t('editor.italic')} label="I" italic />
      <RteBtn active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} title={t('editor.underline')} label="U" underline />
      <RteBtn active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} title={t('editor.strike')} label="S" strike />
      <RteBtn active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()} title={t('editor.code')} label="</>" />
      <span className="rte-sep" />

      <RteBtn active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title={t('editor.bulletList')} label="• —" />
      <RteBtn active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title={t('editor.orderedList')} label="1." />
      <RteBtn active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} title={t('editor.blockquote')} label="❝" />
      <span className="rte-sep" />

      <RteBtn active={editor.isActive('link')} onClick={onLink} title={t('editor.link')} label="🔗" />
      <RteBtn onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} title={t('editor.clearFormat')} label="⌫" />
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

  // NOT a <form>: this dialog renders inside the compose-modal <form>, and a
  // nested form's submit button reloads the page. Confirm is a plain button;
  // Enter in the input confirms.
  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      onSubmit(value);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50" onClick={onCancel}>
      <div
        className="card w-full max-w-md space-y-3"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
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
            onKeyDown={onKey}
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
            <button type="button" className="btn btn-primary" onClick={() => onSubmit(value)}>
              {t('common:btn.confirm')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RteBtn({
  active,
  onClick,
  title,
  label,
  disabled,
  bold,
  italic,
  underline,
  strike,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  label: ReactNode;
  disabled?: boolean;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
}) {
  return (
    <button
      type="button"
      className={`rte-btn ${active ? 'rte-btn-active' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={active}
      style={{
        fontWeight: bold ? 700 : undefined,
        fontStyle: italic ? 'italic' : undefined,
        textDecoration: underline ? 'underline' : strike ? 'line-through' : undefined,
      }}
    >
      {label}
    </button>
  );
}
