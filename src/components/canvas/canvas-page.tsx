/** Replaced in Task 7. The data attribute is the build-elimination sentinel. */
export default function CanvasPage({ node }: { node?: string }) {
  return (
    <div data-gregale-canvas="" className="h-full p-6 text-sm text-muted-foreground">
      Canvas {node ? `· ${node}` : ''}
    </div>
  );
}
