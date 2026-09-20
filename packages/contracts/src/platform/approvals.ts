// Approval workflows — who has to say yes, and in what order, for any kind of request.
//
// Three features had already written this by hand and written it the same way: leave requests,
// attendance regularizations and job requisitions each carry a `pendingManager → pendingHr` pair
// with the first step bound to `employee.managerId` and the second to a permission held company
// wide. That shape is wrong twice over. It names the answer — «مدير», «HR» — instead of describing
// it, so a chain that runs «الموظف ← مدير حركة الفرع ← مدير عام الحركة» cannot be expressed at all;
// and it authorizes off a field on the employee record, which is a reporting line, not an
// authority. The owner said so directly: «الأفضل ما نعتمدش على خانة Manager الموجودة في Employee
// كمرجع أساسي للـauthorization. المرجع الأساسي يكون Department + Branch + Role/Scope + Delegated
// Permissions».
//
// So a step here names neither a person nor a title. It names a PERMISSION and HOW FAR the holder's
// authority over the requester's own unit has to reach:
//
//   unit          — holds the key over the requester's department IN HIS BRANCH   (مدير حركة المهندسين)
//   department    — holds it over that department in EVERY branch                 (مدير عام الحركة)
//   branch        — holds it over the requester's whole branch                    (مدير الفرع)
//   organization  — holds it company-wide                                         (الموارد البشرية)
//
// «HR is a step» stops being a rule in the code and becomes one line of configuration that can be
// deleted. Nothing in this file knows what a department is called, which is the point: the same
// engine runs الحركة, تقنية المعلومات, المالية and العمليات without learning their names.
import { z } from 'zod';
import { objectId } from '../common/index.js';
import { PermissionKeySchema } from '../permissions/def.js';

/**
 * How far an approver's authority over the requester's unit must reach.
 *
 * Deliberately the same four words the permission layer already uses for a grant's reach
 * (ADR-032, Gap 1), because they mean the same thing read from the other end: a grant says how far
 * an authority extends, a step says how far it must extend to count here.
 */
export const APPROVAL_LEVELS = ['unit', 'department', 'branch', 'organization'] as const;
export const ApprovalLevelSchema = z.enum(APPROVAL_LEVELS);
export type ApprovalLevel = z.infer<typeof ApprovalLevelSchema>;

/** One rung of a chain: whoever holds `permissionKey` at `level` over the requester's unit. */
export const ApprovalStepSchema = z
  .object({
    permissionKey: PermissionKeySchema,
    level: ApprovalLevelSchema,
    /**
     * What the screen calls this rung. Optional, and never authoritative — it is a caption for
     * people, and the engine ignores it. Left empty, the screen says «من عنده <key> على <level>».
     */
    label: z.object({ ar: z.string().max(80), en: z.string().max(80) }).nullable().default(null),
  })
  .strict();
export type ApprovalStep = z.infer<typeof ApprovalStepSchema>;

/**
 * A chain, and where it applies.
 *
 * `departmentCatalogId` and `branchId` are both nullable, and null means «any». Resolution takes
 * the MOST SPECIFIC match — department + branch beats department, which beats branch, which beats
 * the company-wide default — so one default can be written once and overridden only where the
 * company actually differs, which is how the owner described it: «الـworkflow يعتمد على الـDepartment
 * + Branch + نوع الطلب».
 */
export const SetApprovalWorkflowSchema = z
  .object({
    requestType: z.string().min(1).max(60),
    departmentCatalogId: objectId().nullable(),
    branchId: objectId().nullable(),
    steps: z.array(ApprovalStepSchema).min(1).max(10),
    isActive: z.boolean().default(true),
  })
  .strict();
export type SetApprovalWorkflow = z.infer<typeof SetApprovalWorkflowSchema>;

export interface ApprovalWorkflowDto {
  id: string;
  requestType: string;
  department: { id: string; name: { ar: string; en: string } } | null;
  branch: { id: string; name: { ar: string; en: string } } | null;
  steps: ApprovalStep[];
  isActive: boolean;
  updatedAt: string;
}

/**
 * A request type the engine can run, as its own module declares it.
 *
 * The list is a registry rather than an enum so a module adds its own without editing this file —
 * the same shape the permission registry uses. `permissionKeys` are the keys that module offers as
 * approval steps, so the configuration screen can offer a list instead of a free-text box.
 */
export interface ApprovalRequestTypeDto {
  key: string;
  moduleId: string;
  name: { ar: string; en: string };
  permissionKeys: string[];
}

/** One rung after the engine has looked for people to fill it. */
export interface ResolvedStepDto {
  permissionKey: string;
  level: ApprovalLevel;
  label: { ar: string; en: string } | null;
  /**
   * False when nobody in the company holds that key at that level over this unit.
   *
   * The step is then SKIPPED rather than blocking: «لو مفيش Branch Manager، يتخطى المستوى ده ويروح
   * للـGeneral Department Manager». A skipped rung stays in the trail, marked, because the reader
   * asking «why did this go straight to HR?» is asking about the rung that was not there.
   */
  staffed: boolean;
}

export const APPROVAL_DECISIONS = ['approved', 'rejected'] as const;
export const ApprovalDecisionSchema = z.enum(APPROVAL_DECISIONS);
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

/**
 * What became of a rung.
 *
 * `skipped` and `covered` are both «nobody decided this», and keeping them apart is the difference
 * between two questions a reader actually asks. `skipped` means the rung was EMPTY — nobody in the
 * company holds that key at that level over this unit, so there was no one to ask. `covered` means
 * somebody FURTHER UP THE SAME CHAIN decided first, and the owner's rule applied: «لو المدير العام
 * وافق مش محتاج مدير الفرع».
 */
export type ApprovalOutcome = ApprovalDecision | 'skipped' | 'covered' | 'pending';

/** A rung that has been decided, or passed, with everything an auditor asks about it. */
export interface ApprovalTrailEntryDto {
  permissionKey: string;
  level: ApprovalLevel;
  label: { ar: string; en: string } | null;
  outcome: ApprovalOutcome;
  decidedBy: { id: string; name: string } | null;
  decidedAt: string | null;
  comment: string | null;
  /**
   * Set when the decider was not who the rung called for and used an explicit override permission.
   *
   * The owner asked for exactly four facts to survive: «مين كان المفروض يوافق، مين وافق فعليًا،
   * الصلاحية/السبب، وقت القرار». The first is the rung itself, the second and fourth are above,
   * and this is the third.
   */
  overriddenWith: string | null;
}

export interface ApprovalTrailDto {
  requestType: string;
  workflowId: string | null;
  steps: ApprovalTrailEntryDto[];
  /** The index of the rung waiting on somebody, or null when the chain is finished. */
  currentStep: number | null;
  /**
   * Whether the reader may decide right now.
   *
   * True when he stands on the live rung — and also when he stands on any rung ABOVE it in this
   * same chain, because deciding early is his own authority, not a trespass on somebody else's:
   * «لو المدير العام وافق مش محتاج مدير الفرع». What he cancels by doing so is everything between,
   * never what comes after him.
   */
  viewerMayDecide: boolean;
  /**
   * The rung the reader would be deciding — his own, which may be above the live one.
   *
   * Null when he may not decide at all. The screen needs it to say «هتوافق كـمدير عام الحركة،
   * وده هيلغي خطوة مدير الفرع» before he presses anything.
   */
  viewerStep: number | null;
  /** The rungs his decision would cancel — below him, and still waiting. */
  viewerCovers: number[];
  /**
   * Whether the reader is not in this chain at all and would be stepping into it.
   *
   * A different thing from deciding early, and it needs `approval.override` and says so in the
   * trail. Somebody in the chain deciding ahead of his turn needs no extra permission.
   */
  viewerMayOverride: boolean;
}

export const DecideApprovalSchema = z
  .object({
    decision: ApprovalDecisionSchema,
    comment: z.string().max(1000).nullable().default(null),
  })
  .strict();
export type DecideApproval = z.infer<typeof DecideApprovalSchema>;
