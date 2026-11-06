import {
  AliasNode,
  AndNode,
  BinaryOperationNode,
  ColumnNode,
  type DeleteQueryNode,
  IdentifierNode,
  type InsertQueryNode,
  JoinNode,
  type MergeQueryNode,
  OnConflictNode,
  OnNode,
  OperationNodeTransformer,
  OperatorNode,
  PrimitiveValueListNode,
  ReferenceNode,
  type SelectQueryNode,
  TableNode,
  type UpdateQueryNode,
  ValueListNode,
  ValueNode,
  ParensNode,
  ValuesNode,
  WhereNode,
  type KyselyPlugin,
  type OperationNode,
  type PluginTransformQueryArgs,
  type PluginTransformResultArgs,
  type QueryId,
  type QueryResult,
  type RootOperationNode,
  type UnknownRow,
} from "kysely";
import { CompanyContextError } from "./errors";

/*
 * The company wall in the query layer (document 05, section 12; document 06, D-4). Every query on a
 * company table is rewritten so that it can only see and write the rows of the context's company:
 *   - SELECT, UPDATE, DELETE: `company_id = <context>` is added for each company table in the
 *     statement, in WHERE for the main tables and in ON for joined tables (so outer joins keep their
 *     meaning), inside subqueries and CTEs too;
 *   - INSERT: `company_id` is filled in, or checked to equal the context;
 *   - ON CONFLICT DO UPDATE only touches rows of the context's company;
 *   - anything that could escape the wall (changing company_id, insert-from-select, right and full
 *     joins, MERGE) is refused.
 * The database's composite foreign keys are the second line: a row cannot refer to another company's row.
 */

interface TableRef {
  readonly name: string;
  readonly qualifier: string;
}

function tableRef(node: OperationNode): TableRef | undefined {
  if (TableNode.is(node)) return { name: node.table.identifier.name, qualifier: node.table.identifier.name };
  if (AliasNode.is(node) && TableNode.is(node.node) && IdentifierNode.is(node.alias)) {
    return { name: node.node.table.identifier.name, qualifier: node.alias.name };
  }
  return undefined;
}

const COMPANY_ID = "company_id";

/**
 * True when `node` already requires `<qualifier>.company_id = <companyId>` through a chain of ANDs
 * (and parentheses). OR is never searched: a condition that may be bypassed does not count.
 */
function alreadyScoped(node: OperationNode | undefined, qualifier: string, companyId: string): boolean {
  if (node === undefined) return false;
  if (WhereNode.is(node)) return alreadyScoped(node.where, qualifier, companyId);
  if (OnNode.is(node)) return alreadyScoped(node.on, qualifier, companyId);
  if (ParensNode.is(node)) return alreadyScoped(node.node, qualifier, companyId);
  if (AndNode.is(node)) return alreadyScoped(node.left, qualifier, companyId) || alreadyScoped(node.right, qualifier, companyId);
  if (BinaryOperationNode.is(node) && OperatorNode.is(node.operator) && node.operator.operator === "=") {
    const left = node.leftOperand;
    const right = node.rightOperand;
    return (
      ReferenceNode.is(left) &&
      ColumnNode.is(left.column) &&
      left.column.column.name === COMPANY_ID &&
      left.table?.table.identifier.name === qualifier &&
      ValueNode.is(right) &&
      right.value === companyId
    );
  }
  return false;
}

class CompanyScopeTransformer extends OperationNodeTransformer {
  readonly #companyId: string;
  readonly #companyTables: ReadonlySet<string>;

  constructor(companyId: string, companyTables: ReadonlySet<string>) {
    super();
    this.#companyId = companyId;
    this.#companyTables = companyTables;
  }

  #scoped(node: OperationNode | undefined): TableRef | undefined {
    if (node === undefined) return undefined;
    const ref = tableRef(node);
    return ref !== undefined && this.#companyTables.has(ref.name) ? ref : undefined;
  }

  #predicate(qualifier: string): OperationNode {
    return BinaryOperationNode.create(ReferenceNode.create(ColumnNode.create(COMPANY_ID), TableNode.create(qualifier)), OperatorNode.create("="), ValueNode.create(this.#companyId));
  }

  #and(where: WhereNode | undefined, allRefs: readonly TableRef[]): WhereNode | undefined {
    const [first, ...rest] = allRefs.filter((r) => !alreadyScoped(where, r.qualifier, this.#companyId));
    if (first === undefined) return where;
    const combined = rest.reduce<OperationNode>((acc, r) => AndNode.create(acc, this.#predicate(r.qualifier)), this.#predicate(first.qualifier));
    return where === undefined ? WhereNode.create(combined) : WhereNode.cloneWithOperation(where, "And", combined);
  }

  /** Scope the joined tables inside their ON clauses; refuse joins that would let the wall leak. */
  #joins(joins: readonly JoinNode[] | undefined, hasScopedBase: boolean): { joins: JoinNode[] | undefined; extraWhere: TableRef[] } {
    const extraWhere: TableRef[] = [];
    const out = joins?.map((join) => {
      const ref = this.#scoped(join.table);
      if (ref === undefined) return join;
      if (join.joinType === "RightJoin" || join.joinType === "FullJoin") {
        throw new CompanyContextError("right and full joins are not allowed on company tables");
      }
      if (join.joinType === "CrossJoin" || join.joinType === "LateralInnerJoin" || join.joinType === "LateralLeftJoin") {
        extraWhere.push(ref);
        return join;
      }
      return alreadyScoped(join.on, ref.qualifier, this.#companyId) ? join : JoinNode.cloneWithOn(join, this.#predicate(ref.qualifier));
    });
    if (hasScopedBase && joins?.some((j) => j.joinType === "RightJoin" || j.joinType === "FullJoin") === true) {
      throw new CompanyContextError("right and full joins are not allowed on company tables");
    }
    return { joins: out, extraWhere };
  }

  protected override transformSelectQuery(node: SelectQueryNode, queryId?: QueryId): SelectQueryNode {
    const t = super.transformSelectQuery(node, queryId);
    const base = (t.from?.froms ?? []).map((f) => this.#scoped(f)).filter((r): r is TableRef => r !== undefined);
    const { joins, extraWhere } = this.#joins(t.joins, base.length > 0);
    const where = this.#and(t.where, [...base, ...extraWhere]);
    return { ...t, ...(joins === undefined ? {} : { joins }), ...(where === undefined ? {} : { where }) };
  }

  protected override transformUpdateQuery(node: UpdateQueryNode, queryId?: QueryId): UpdateQueryNode {
    const t = super.transformUpdateQuery(node, queryId);
    if (t.updates?.some((u) => ColumnNode.is(u.column) && u.column.column.name === COMPANY_ID) === true) {
      throw new CompanyContextError("company_id cannot be changed");
    }
    const base = [this.#scoped(t.table), ...(t.from?.froms ?? []).map((f) => this.#scoped(f))].filter((r): r is TableRef => r !== undefined);
    const { joins, extraWhere } = this.#joins(t.joins, base.length > 0);
    const where = this.#and(t.where, [...base, ...extraWhere]);
    return { ...t, ...(joins === undefined ? {} : { joins }), ...(where === undefined ? {} : { where }) };
  }

  protected override transformDeleteQuery(node: DeleteQueryNode, queryId?: QueryId): DeleteQueryNode {
    const t = super.transformDeleteQuery(node, queryId);
    const base = [...t.from.froms.map((f) => this.#scoped(f)), ...(t.using?.tables ?? []).map((f) => this.#scoped(f))].filter((r): r is TableRef => r !== undefined);
    const { joins, extraWhere } = this.#joins(t.joins, base.length > 0);
    const where = this.#and(t.where, [...base, ...extraWhere]);
    return { ...t, ...(joins === undefined ? {} : { joins }), ...(where === undefined ? {} : { where }) };
  }

  protected override transformMergeQuery(node: MergeQueryNode, queryId?: QueryId): MergeQueryNode {
    const t = super.transformMergeQuery(node, queryId);
    if (this.#scoped(t.into) !== undefined || this.#scoped(t.using?.table) !== undefined) {
      throw new CompanyContextError("MERGE is not allowed on company tables");
    }
    return t;
  }

  protected override transformInsertQuery(node: InsertQueryNode, queryId?: QueryId): InsertQueryNode {
    const t = super.transformInsertQuery(node, queryId);
    const into = this.#scoped(t.into);
    if (into === undefined) return t;
    if (t.values === undefined || !ValuesNode.is(t.values)) {
      throw new CompanyContextError("INSERT into a company table needs explicit values (insert-from-select and default values are not allowed)");
    }
    const columns = t.columns ?? [];
    const at = columns.findIndex((c) => c.column.name === COMPANY_ID);
    const rows = t.values.values.map((row) => {
      if (ValueListNode.is(row)) {
        if (at < 0) return ValueListNode.create([...row.values, ValueNode.create(this.#companyId)]);
        const cell = row.values[at];
        if (cell === undefined || !ValueNode.is(cell) || cell.value !== this.#companyId) throw new CompanyContextError(`INSERT into ${into.name} with a company_id that is not the context's`);
        return row;
      }
      if (PrimitiveValueListNode.is(row)) {
        if (at < 0) return PrimitiveValueListNode.create([...row.values, this.#companyId]);
        if (row.values[at] !== this.#companyId) throw new CompanyContextError(`INSERT into ${into.name} with a company_id that is not the context's`);
        return row;
      }
      throw new CompanyContextError("unsupported INSERT row");
    });
    let onConflict = t.onConflict;
    if (onConflict !== undefined) {
      if (onConflict.updates?.some((u) => ColumnNode.is(u.column) && u.column.column.name === COMPANY_ID) === true) {
        throw new CompanyContextError("company_id cannot be changed");
      }
      if (onConflict.updates !== undefined) {
        // DO UPDATE may only touch rows of this company, even when the conflict is on a key that is not company-prefixed
        onConflict = OnConflictNode.cloneWithUpdateWhere(onConflict, this.#predicate(into.qualifier));
      }
    }
    return { ...t, columns: at < 0 ? [...columns, ColumnNode.create(COMPANY_ID)] : columns, values: ValuesNode.create(rows), ...(onConflict === undefined ? {} : { onConflict }) };
  }
}

/** Queries on the installation (owner groups, nodes, devices) must not touch company tables. */
class InstallationScopeTransformer extends OperationNodeTransformer {
  readonly #companyTables: ReadonlySet<string>;
  constructor(companyTables: ReadonlySet<string>) {
    super();
    this.#companyTables = companyTables;
  }
  protected override transformTable(node: TableNode, queryId?: QueryId): TableNode {
    if (this.#companyTables.has(node.table.identifier.name)) {
      throw new CompanyContextError(`${node.table.identifier.name} is a company table: it needs a company context (store.scoped)`);
    }
    return super.transformTable(node, queryId);
  }
}

class TransformPlugin implements KyselyPlugin {
  readonly #transformer: OperationNodeTransformer;
  constructor(transformer: OperationNodeTransformer) {
    this.#transformer = transformer;
  }
  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    return this.#transformer.transformNode(args.node, args.queryId);
  }
  transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    return Promise.resolve(args.result);
  }
}

export function companyScopePlugin(companyId: string, companyTables: ReadonlySet<string>): KyselyPlugin {
  return new TransformPlugin(new CompanyScopeTransformer(companyId, companyTables));
}

export function installationScopePlugin(companyTables: ReadonlySet<string>): KyselyPlugin {
  return new TransformPlugin(new InstallationScopeTransformer(companyTables));
}
