interface RichTextProps {
  text: string;
}

/** Renders model text with **bold** spans. Everything else stays plain text (no HTML injection). */
export function RichText({ text }: RichTextProps) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
          <strong key={i} className="font-semibold">
            {part.slice(2, -2)}
          </strong>
        ) : (
          part
        ),
      )}
    </>
  );
}
