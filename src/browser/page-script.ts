export interface RawAction {
  ref: string;
  z: number;
  onScreen: boolean;
  kind: 'click' | 'type' | 'select' | 'check';
  role: string;
  name: string;
  context: string;
  value: string;
  checked?: boolean;
  required: boolean;
  filled: boolean;
  inputType: string;
  format: string;
  options?: { index: number; label: string }[];
}

export interface RawText {
  ref: string;
  z: number;
  role: string;
  text: string;
  context: string;
}

export function stackOrder(node: Element): number {
  let top = 0;
  for (let current: Element | null = node; current; current = current.parentElement) {
    const value = Number(getComputedStyle(current).zIndex);
    if (Number.isFinite(value) && value > top) top = value;
  }
  return top;
}

export interface RawPage {
  url: string;
  title: string;
  busy: boolean;
  actions: RawAction[];
  texts: RawText[];
  scrollable: boolean;
  scrollableUp: boolean;
}

export function readPage(limits: { actions: number; texts: number }): RawPage {
  const attribute = 'data-jev-ref';
  for (const stale of Array.from(document.querySelectorAll('[' + attribute + ']'))) stale.removeAttribute(attribute);

  const onScreen = (node: Element) => Array.from(node.getClientRects()).some(rect =>
    rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth);
  const visible = (node: Element) => {
    if (!node.getClientRects().length) return false;
    const style = getComputedStyle(node);
    if (style.visibility === 'hidden' || style.opacity === '0') return false;
    return !node.closest('[inert], [aria-hidden="true"]');
  };
  const zOrder = (node: Element) => {
    let top = 0;
    for (let current: Element | null = node; current; current = current.parentElement) {
      const value = Number(getComputedStyle(current).zIndex);
      if (Number.isFinite(value) && value > top) top = value;
    }
    return top;
  };
  const text = (node: Element | null | undefined) => (node instanceof HTMLElement ? node.innerText : node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const referenced = (node: Element, attributeName: string) => (node.getAttribute(attributeName) ?? '')
    .split(/\s+/).filter(Boolean)
    .map(id => text(node.ownerDocument.getElementById(id))).join(' ').trim();

  const accessibleName = (node: Element): string => {
    const labelled = referenced(node, 'aria-labelledby');
    if (labelled) return labelled;
    const label = node.getAttribute('aria-label');
    if (label?.trim()) return label.trim();
    if (node instanceof HTMLInputElement || node instanceof HTMLSelectElement || node instanceof HTMLTextAreaElement) {
      const labels = Array.from(node.labels ?? []).map(item => text(item)).filter(Boolean).join(' ');
      if (labels) return labels;
      if (node instanceof HTMLInputElement && node.placeholder.trim()) return node.placeholder.trim();
    }
    const own = text(node);
    if (own && own.length <= 200) return own;
    const title = node.getAttribute('title');
    if (title?.trim()) return title.trim();
    const image = node.querySelector('img[alt]');
    if (image?.getAttribute('alt')?.trim()) return image.getAttribute('alt')!.trim();
    const name = node.getAttribute('name');
    return name?.trim() ?? '';
  };

  const context = (node: Element): string => {
    const region = node.closest('form, section, nav, article, aside, header, footer, main, [role="region"], [role="dialog"], li, tr');
    const heading = region?.querySelector('h1, h2, h3, h4, legend, caption, [role="heading"]');
    const parts = [text(heading), region && region !== node ? text(region) : ''];
    return parts.filter(Boolean).join(' | ').slice(0, 240);
  };

  const explicitRole = (node: Element) => node.getAttribute('role')?.trim().split(/\s+/)[0] ?? '';
  const implicitRole = (node: Element): string => {
    if (node instanceof HTMLAnchorElement) return node.href ? 'link' : '';
    if (node instanceof HTMLButtonElement) return 'button';
    if (node instanceof HTMLSelectElement) return node.multiple ? 'listbox' : 'combobox';
    if (node instanceof HTMLTextAreaElement) return 'textbox';
    if (node instanceof HTMLInputElement) {
      if (['checkbox', 'radio'].includes(node.type)) return node.type;
      if (['submit', 'button', 'reset', 'image'].includes(node.type)) return 'button';
      return 'textbox';
    }
    return '';
  };

  const disabled = (node: Element) => node.hasAttribute('disabled') || node.getAttribute('aria-disabled') === 'true'
    || !!node.closest('fieldset[disabled]');

  const dateFormat = (node: Element) => {
    const source = [node.getAttribute('placeholder'), node.getAttribute('pattern'), node.getAttribute('title'), accessibleName(node)].join(' ').toLowerCase();
    const found = ['yyyy-mm-dd', 'dd/mm/yyyy', 'mm/dd/yyyy', 'dd.mm.yyyy', 'dd-mm-yyyy', 'yyyy/mm/dd']
      .filter(candidate => source.replaceAll('aaaa', 'yyyy').replaceAll('gg', 'dd').includes(candidate));
    return found.length === 1 ? found[0]! : '';
  };

  const clickableRoles = ['button', 'link', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'gridcell', 'cell', 'treeitem', 'switch'];
  const found: { node: Element; z: number; action: Omit<RawAction, 'ref' | 'z'> }[] = [];
  for (const node of Array.from(document.querySelectorAll('*'))) {
    if (!visible(node) || !onScreen(node) || disabled(node)) continue;
    const role = explicitRole(node) || implicitRole(node);
    const editable = node instanceof HTMLElement && node.isContentEditable;
    let kind: RawAction['kind'] | '' = '';
    if (node instanceof HTMLSelectElement) kind = 'select';
    else if (['checkbox', 'radio', 'switch'].includes(role) && !(node instanceof HTMLAnchorElement)) kind = 'check';
    else if (editable || node instanceof HTMLTextAreaElement || (node instanceof HTMLInputElement && !['checkbox', 'radio', 'submit', 'button', 'reset', 'image', 'hidden', 'file'].includes(node.type))) kind = 'type';
    else if (clickableRoles.includes(role)) kind = 'click';
    if (!kind) continue;
    if (kind === 'type' && (node as HTMLInputElement).readOnly && !node.hasAttribute('aria-expanded') && !node.hasAttribute('aria-controls')) kind = 'click';
    const name = accessibleName(node);
    if (!name && kind === 'click') continue;
    const input = node as HTMLInputElement;
    const value = node instanceof HTMLSelectElement
      ? Array.from(node.selectedOptions).map(option => option.label).join(', ')
      : node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement ? input.value
      : editable ? text(node) : '';
    found.push({ node, z: zOrder(node), action: {
      kind, onScreen: true, role: role || 'generic', name: name.slice(0, 200), context: context(node),
      value: value.slice(0, 200),
      ...(kind === 'check' ? { checked: node instanceof HTMLInputElement ? node.checked : node.getAttribute('aria-checked') === 'true' } : {}),
      required: node.hasAttribute('required') || node.getAttribute('aria-required') === 'true',
      filled: kind === 'type' || kind === 'select' ? value.trim().length > 0 : false,
      inputType: node instanceof HTMLInputElement ? node.type : '',
      format: node instanceof HTMLInputElement && node.type === 'date' ? 'yyyy-mm-dd' : dateFormat(node),
      ...(node instanceof HTMLSelectElement
        ? { options: Array.from(node.options).filter(option => !option.disabled).slice(0, 200).map(option => ({ index: option.index, label: text(option).slice(0, 120) })) }
        : {}),
    } });
  }
  found.sort((left, right) => right.z - left.z);
  const actions: RawAction[] = found.slice(0, limits.actions).map((entry, position) => {
    const ref = 'e' + position;
    entry.node.setAttribute(attribute, ref);
    return { ref, z: entry.z, ...entry.action };
  });

  const blockTags = ['P', 'LI', 'TD', 'TH', 'DD', 'DT', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'FIGCAPTION', 'OUTPUT', 'SPAN', 'DIV', 'ADDRESS', 'TIME', 'STRONG', 'EM', 'LABEL'];
  const blocks: { z: number; block: Omit<RawText, 'ref' | 'z'> }[] = [];
  const seen = new Set<string>();
  for (const node of Array.from(document.querySelectorAll(blockTags.join(',') + ', [role="status"], [role="alert"], [role="heading"]'))) {
    if (!visible(node) || !onScreen(node)) continue;
    if (node.querySelector(blockTags.join(','))) continue;
    const body = text(node);
    if (!body || body.length > 600 || seen.has(body)) continue;
    seen.add(body);
    const role = explicitRole(node) || (/^H[1-6]$/.test(node.tagName) ? 'heading' : 'text');
    blocks.push({ z: zOrder(node), block: { role, text: body, context: context(node) } });
  }
  blocks.sort((left, right) => right.z - left.z);
  const texts: RawText[] = blocks.slice(0, limits.texts).map((entry, position) => ({ ref: 't' + position, z: entry.z, ...entry.block }));

  return {
    url: location.href,
    title: document.title,
    busy: document.readyState !== 'complete' || !!document.querySelector('[aria-busy="true"], [role="progressbar"]'),
    actions, texts,
    scrollable: window.scrollY + window.innerHeight < document.documentElement.scrollHeight - 40,
    scrollableUp: window.scrollY > 40,
  };
}
