import propsAlias, { propAlias } from './propsAlias';
import { TYPE_TEXT } from './constants';
import Container from './Container';

export interface RawNode {
  id: number;
  type: string;
  props?: any;
  nodes?: { [key: number]: RawNode };
  children?: Array<RawNode | number>;
  text?: string;
}

function toRawNode(node: VNode): RawNode {
  if (node.type === TYPE_TEXT) {
    return {
      id: node.id,
      type: node.type,
      text: node.text,
    };
  }

  return {
    id: node.id,
    type: node.type,
    props: propsAlias(node.props, node.type),
    children: [],
    text: node.text,
  };
}

function toRawProps(prop: string, value: any, type: string) {
  return propAlias(prop, value, type);
}

export default class VNode {
  id: number;
  container: Container;
  mounted = false;
  deleted = false;
  type: string;
  props?: any;
  parent: VNode | null = null;
  firstChild: VNode | null = null;
  lastChild: VNode | null = null;
  size = 0;
  previousSibling: VNode | null = null;
  nextSibling: VNode | null = null;
  text?: string;

  constructor({ id, type, props, container }: { id: number; type: string; props?: any; container: any }) {
    this.id = id;
    this.container = container;
    this.type = type;
    this.props = props;
  }

  appendChild(node: VNode, immediately: boolean) {
    this.removeChild(node, immediately);
    this.size += 1;

    node.parent = this;

    if (!this.firstChild) {
      this.firstChild = node;
    }

    if (this.lastChild) {
      this.lastChild.nextSibling = node;
      node.previousSibling = this.lastChild;
    }

    this.lastChild = node;

    if (this.isMounted()) {
      this.container.requestUpdate(
        {
          type: 'splice',
          path: this.path,
          start: node.index,
          id: node.id,
          deleteCount: 0,
          children: this.children,
          items: [node.toJSON()],
          node: this,
        },
        immediately
      );
    }
  }

  removeChild(node: VNode, immediately: boolean) {
    const { previousSibling, nextSibling } = node;

    if (node.parent !== this) {
      return;
    }

    const index = node.index;
    this.size -= 1;

    if (this.firstChild === node) {
      this.firstChild = node.nextSibling;
    }

    if (this.lastChild === node) {
      this.lastChild = node.previousSibling;
    }

    if (previousSibling) {
      previousSibling.nextSibling = nextSibling;
    }

    if (nextSibling) {
      nextSibling.previousSibling = previousSibling;
    }

    node.previousSibling = null;
    node.nextSibling = null;
    node.deleted = true;

    if (this.isMounted()) {
      this.container.requestUpdate(
        {
          type: 'splice',
          path: this.path,
          start: index,
          id: node.id,
          deleteCount: 1,
          children: this.children,
          items: [],
          node: this,
        },
        immediately
      );
    }
  }

  insertBefore(node: VNode, referenceNode: VNode, immediately: boolean) {
    this.removeChild(node, immediately);
    this.size += 1;

    node.parent = this;

    if (referenceNode === this.firstChild) {
      this.firstChild = node;
    }

    if (referenceNode.previousSibling) {
      referenceNode.previousSibling.nextSibling = node;
      node.previousSibling = referenceNode.previousSibling;
    }

    referenceNode.previousSibling = node;
    node.nextSibling = referenceNode;

    if (this.isMounted()) {
      this.container.requestUpdate(
        {
          type: 'splice',
          path: this.path,
          start: node.index,
          id: node.id,
          deleteCount: 0,
          children: this.children,
          items: [node.toJSON()],
          node: this,
        },
        immediately
      );
    }
  }

  update(payload?: any[]) {
    if (this.type === 'text' || !payload) {
      this.container.requestUpdate({
        type: 'splice',
        // root 不会更新，所以肯定有 parent
        path: this.parent!.path,
        start: this.index,
        id: this.id,
        deleteCount: 1,
        items: [this.toJSON()],
        node: this,
      });

      return;
    }

    for (let i = 0; i < payload.length; i = i + 2) {
      const [propName, propValue] = toRawProps(payload[i], payload[i + 1], this.type);

      let path = this.parent!.path + '.nodes.' + this.id + '.props';

      if (process.env.REMAX_PLATFORM === 'ali') {
        path = this.parent!.path + '.children[' + this.index + '].props';
      }

      this.container.requestUpdate({
        type: 'set',
        path,
        name: propName,
        value: propValue,
        node: this,
      });
    }
  }

  get index(): number {
    let value = 0;
    let previousSibling = this.previousSibling;

    while (previousSibling) {
      value += 1;
      previousSibling = previousSibling.previousSibling;
    }

    return value;
  }

  get children() {
    const arr = [];
    let item = this.firstChild;

    while (item) {
      arr.push(item);
      item = item.nextSibling;
    }

    return arr;
  }

  get path() {
    let dataPath = 'root';
    const parents = [];
    let parent = this.parent;

    while (parent) {
      parents.unshift(parent);
      parent = parent.parent;
    }

    for (let i = 0; i < parents.length; i++) {
      const child = parents[i + 1] || this;

      if (process.env.REMAX_PLATFORM === 'ali') {
        dataPath += '.children.' + child.index + '';
      } else {
        dataPath += '.nodes.' + child.id + '';
      }
    }

    return dataPath;
  }

  isMounted(): boolean {
    return this.parent ? this.parent.isMounted() : this.mounted;
  }

  isDeleted(): boolean {
    return this.deleted === true ? this.deleted : this.parent?.isDeleted() ?? false;
  }

  toJSON() {
    const stack: Array<{
      currentNode: RawNode;
      children: VNode[];
    }> = [];
    const rawNode = toRawNode(this);

    stack.push({
      currentNode: rawNode,
      children: this.children,
    });

    while (stack.length > 0) {
      // while 循环已经保证了不会有空值
      const stackItem = stack.pop()!;

      const { children = [], currentNode } = stackItem;

      for (let i = children.length - 1; i >= 0; i--) {
        const currentVNode = children[i];
        const currentRawNode = toRawNode(currentVNode);

        if (process.env.REMAX_PLATFORM !== 'ali') {
          currentNode.children!.unshift(currentRawNode.id);
        } else {
          currentNode.children!.unshift(currentRawNode);
        }

        if (process.env.REMAX_PLATFORM !== 'ali') {
          if (!currentNode.nodes) {
            currentNode.nodes = {};
          }
          currentNode.nodes[currentRawNode.id] = currentRawNode;
        }

        stack.push({
          currentNode: currentRawNode,
          children: currentVNode.children,
        });
      }
    }

    return rawNode;
  }
}
