import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { useTranslation } from 'react-i18next';

/**
 * Minimal rich-text editor for Bacheca messages. Emits HTML on every change;
 * the server re-sanitizes against a strict allowlist (sanitizeBulletinHtml), so
 * this is purely an authoring affordance, never the security boundary. Scope is
 * "text + links": bold/italic, lists, a heading level, and safe links.
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

  return (
    <div className="rte">
      <Toolbar editor={editor} t={t} />
      <EditorContent editor={editor} className="rte-content" data-placeholder={placeholder} />
    </div>
  );
}

function Toolbar({ editor, t }: { editor: Editor; t: (k: string) => string }) {
  function setLink() {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt(t('editor.linkPrompt'), prev ?? 'https://');
    if (url === null) return;
    if (url.trim() === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
  }

  return (
    <div className="rte-toolbar" role="toolbar">
      <RteBtn active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title={t('editor.bold')} label="B" bold />
      <RteBtn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title={t('editor.italic')} label="I" italic />
      <RteBtn active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title={t('editor.heading')} label="H" />
      <span className="rte-sep" />
      <RteBtn active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title={t('editor.bulletList')} label="• —" />
      <RteBtn active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title={t('editor.orderedList')} label="1." />
      <span className="rte-sep" />
      <RteBtn active={editor.isActive('link')} onClick={setLink} title={t('editor.link')} label="🔗" />
      {editor.isActive('link') && (
        <RteBtn active={false} onClick={() => editor.chain().focus().unsetLink().run()} title={t('editor.unlink')} label="⛓✕" />
      )}
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
