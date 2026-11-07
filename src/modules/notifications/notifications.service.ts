import { Injectable, NotFoundException } from '@nestjs/common';
import type { Membership } from '../../auth/membership.guard.js';
import { SupabaseService } from '../../supabase/supabase.service.js';

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  type: string;
  link: string | null;
  studentId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface GradesSavedEvent {
  institutionId: string;
  subjectId: string;
  periodId: string;
  studentIds: string[];
}

export interface AttendanceSavedEvent {
  institutionId: string;
  courseId: string;
  date: string;
  absentStudentIds: string[];
}

export interface AnnouncementCreatedEvent {
  institutionId: string;
  announcementId: string;
  scope: 'institution' | 'course' | 'student';
  courseId: string | null;
  studentId: string | null;
  title: string;
}

interface NewNotification {
  institution_id: string;
  recipient_id: string;
  title: string;
  body: string;
  type?: 'grade' | 'attendance' | 'announcement' | 'general';
  link?: string;
  student_id?: string;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly supabase: SupabaseService) {}

  /** Últimas 50 notificaciones del usuario en la institución activa. */
  async list(membership: Membership): Promise<NotificationItem[]> {
    const { data, error } = await this.supabase.admin
      .from('notifications')
      .select('id, title, body, type, link, student_id, read_at, created_at')
      .eq('institution_id', membership.institutionId)
      .eq('recipient_id', membership.userId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return (data ?? []).map((n: any) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      type: n.type,
      link: n.link,
      studentId: n.student_id,
      readAt: n.read_at,
      createdAt: n.created_at,
    }));
  }

  /** Cantidad de notificaciones sin leer del usuario en la institución. */
  async unreadCount(membership: Membership): Promise<{ count: number }> {
    const { data, error } = await this.supabase.admin
      .from('notifications')
      .select('id')
      .eq('institution_id', membership.institutionId)
      .eq('recipient_id', membership.userId)
      .is('read_at', null);
    if (error) throw error;
    return { count: data?.length ?? 0 };
  }

  /**
   * Marca una notificación como leída. Si no existe, es de otra institución
   * o pertenece a otro usuario, responde 404 para no revelar su existencia.
   */
  async markRead(
    membership: Membership,
    id: string,
  ): Promise<{ success: true }> {
    const { data, error } = await this.supabase.admin
      .from('notifications')
      .select('id, institution_id, recipient_id')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (
      !data ||
      data.institution_id !== membership.institutionId ||
      data.recipient_id !== membership.userId
    ) {
      throw new NotFoundException('Notificación no encontrada');
    }
    const { error: updateError } = await this.supabase.admin
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', data.id)
      .is('read_at', null);
    if (updateError) throw updateError;
    return { success: true };
  }

  /**
   * Borra una notificación propia. Si no existe, es de otra institución o
   * pertenece a otro usuario, responde 404 igual que markRead.
   */
  async remove(membership: Membership, id: string): Promise<void> {
    const { data, error } = await this.supabase.admin
      .from('notifications')
      .select('id, institution_id, recipient_id')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (
      !data ||
      data.institution_id !== membership.institutionId ||
      data.recipient_id !== membership.userId
    ) {
      throw new NotFoundException('Notificación no encontrada');
    }
    const { error: deleteError } = await this.supabase.admin
      .from('notifications')
      .delete()
      .eq('id', data.id);
    if (deleteError) throw deleteError;
  }

  /** Marca como leídas todas las pendientes del usuario en la institución. */
  async markAllRead(membership: Membership): Promise<{ updated: number }> {
    const { data, error } = await this.supabase.admin
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('institution_id', membership.institutionId)
      .eq('recipient_id', membership.userId)
      .is('read_at', null)
      .select('id');
    if (error) throw error;
    return { updated: data?.length ?? 0 };
  }

  /** 'grades.saved': avisa a los tutores de cada alumno con nota cargada. */
  async onGradesSaved(event: GradesSavedEvent): Promise<void> {
    const studentIds = event.studentIds ?? [];
    if (!studentIds.length) return;

    const { data: subject, error } = await this.supabase.admin
      .from('subjects')
      .select('name')
      .eq('id', event.subjectId)
      .maybeSingle();
    if (error) throw error;
    const subjectName = subject?.name ?? 'la materia';

    const guardians = await this.guardiansByStudent(
      event.institutionId,
      studentIds,
    );

    const rows: NewNotification[] = [];
    for (const studentId of studentIds) {
      for (const recipientId of guardians.get(studentId) ?? []) {
        rows.push({
          institution_id: event.institutionId,
          recipient_id: recipientId,
          title: 'Nueva nota',
          body: `Nueva nota en ${subjectName}`,
          type: 'grade',
          link: '/calificaciones',
          student_id: studentId,
        });
      }
    }
    await this.insertAll(rows);
  }

  /** 'attendance.saved': avisa a los tutores de cada alumno ausente. */
  async onAttendanceSaved(event: AttendanceSavedEvent): Promise<void> {
    const studentIds = event.absentStudentIds ?? [];
    if (!studentIds.length) return;

    const { data: students, error } = await this.supabase.admin
      .from('students')
      .select('id, first_name, last_name')
      .in('id', studentIds);
    if (error) throw error;
    const names = new Map<string, string>(
      (students ?? []).map((s: any) => [
        s.id,
        `${s.first_name} ${s.last_name}`.trim(),
      ]),
    );

    const guardians = await this.guardiansByStudent(
      event.institutionId,
      studentIds,
    );

    const rows: NewNotification[] = [];
    for (const studentId of studentIds) {
      const name = names.get(studentId) ?? 'El alumno';
      for (const recipientId of guardians.get(studentId) ?? []) {
        rows.push({
          institution_id: event.institutionId,
          recipient_id: recipientId,
          title: 'Inasistencia registrada',
          body: `${name} estuvo ausente el ${event.date}`,
          type: 'attendance',
          link: '/asistencia',
          student_id: studentId,
        });
      }
    }
    await this.insertAll(rows);
  }

  /**
   * 'announcement.created': avisa a los tutores destinatarios según el
   * alcance del comunicado (institución, curso o alumno puntual).
   */
  async onAnnouncementCreated(event: AnnouncementCreatedEvent): Promise<void> {
    const recipients = await this.announcementRecipients(event);
    await this.insertAll(
      [...recipients].map((recipientId) => ({
        institution_id: event.institutionId,
        recipient_id: recipientId,
        title: 'Nuevo comunicado',
        body: `Nuevo comunicado: ${event.title}`,
        type: 'announcement' as const,
        link: '/comunicados',
      })),
    );
  }

  /** user_id de tutores destinatarios de un comunicado, sin duplicados. */
  private async announcementRecipients(
    event: AnnouncementCreatedEvent,
  ): Promise<Set<string>> {
    if (event.scope === 'student') {
      if (!event.studentId) return new Set();
      const guardians = await this.guardiansByStudent(event.institutionId, [
        event.studentId,
      ]);
      return new Set(guardians.get(event.studentId) ?? []);
    }
    if (event.scope === 'course') {
      if (!event.courseId) return new Set();
      const { data: students, error } = await this.supabase.admin
        .from('students')
        .select('id')
        .eq('institution_id', event.institutionId)
        .eq('course_id', event.courseId);
      if (error) throw error;
      const guardians = await this.guardiansByStudent(
        event.institutionId,
        (students ?? []).map((s: any) => s.id),
      );
      const recipients = new Set<string>();
      for (const userIds of guardians.values()) {
        for (const userId of userIds) recipients.add(userId);
      }
      return recipients;
    }
    if (event.scope === 'institution') {
      const { data, error } = await this.supabase.admin
        .from('memberships')
        .select('user_id')
        .eq('institution_id', event.institutionId)
        .eq('role', 'guardian');
      if (error) throw error;
      return new Set((data ?? []).map((m: any) => m.user_id));
    }
    return new Set();
  }

  /**
   * Mapa studentId → set de user_id de los tutores vinculados al alumno en
   * la institución, resolviendo guardian_links → memberships.
   */
  private async guardiansByStudent(
    institutionId: string,
    studentIds: string[],
  ): Promise<Map<string, Set<string>>> {
    const result = new Map<string, Set<string>>();
    if (!studentIds.length) return result;

    const { data: links, error } = await this.supabase.admin
      .from('guardian_links')
      .select('student_id, guardian_membership_id')
      .in('student_id', studentIds);
    if (error) throw error;
    if (!links?.length) return result;

    const membershipIds = [
      ...new Set(links.map((l: any) => l.guardian_membership_id)),
    ];
    const { data: guardians, error: guardiansError } =
      await this.supabase.admin
        .from('memberships')
        .select('id, user_id')
        .eq('institution_id', institutionId)
        .eq('role', 'guardian')
        .in('id', membershipIds);
    if (guardiansError) throw guardiansError;

    const userByMembership = new Map<string, string>(
      (guardians ?? []).map((g: any) => [g.id, g.user_id]),
    );
    for (const link of links) {
      const userId = userByMembership.get(link.guardian_membership_id);
      if (!userId) continue;
      const set = result.get(link.student_id) ?? new Set<string>();
      set.add(userId);
      result.set(link.student_id, set);
    }
    return result;
  }

  private async insertAll(rows: NewNotification[]): Promise<void> {
    if (!rows.length) return;
    const { error } = await this.supabase.admin
      .from('notifications')
      .insert(rows);
    if (error) throw error;
  }
}
