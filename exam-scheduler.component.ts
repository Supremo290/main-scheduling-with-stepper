import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { ApiService } from '../api.service';
import { GlobalService } from '../global.service';
import { MatDialog } from '@angular/material';
import Swal from 'sweetalert2';
import { SharedDataService } from '../shared-data.service';
import { DatePickerComponent } from '../date-picker/date-picker.component';
import { 
  Exam, 
  ScheduledExam, 
  ToastMessage, 
  SafeSlotOption, 
  ExamDay, 
  ExamGroup 
} from '../subject-code';

@Component({
  selector: 'app-exam-scheduler',
  templateUrl: './exam-scheduler.component.html',
  styleUrls: ['./exam-scheduler.component.scss']
})
export class ExamSchedulerComponent implements OnInit {
  // State management
  currentStep: 'import' | 'generate' | 'summary' | 'timetable' | 'coursegrid' = 'import';
  isLoadingApi: boolean = false;
  
  // Core data
  rawCodes: any[] = [];
  exams: Exam[] = [];
  rooms: string[] = [];
  roomCapacities: Map<string, number> = new Map();
  generatedSchedule: ScheduledExam[] = [];
  subjectTypes: Map<string, 'genEd' | 'major'> = new Map();
  
  // Exam configuration
  examDates: string[] = ['', '', ''];
  days: string[] = ['Day 1', 'Day 2', 'Day 3'];
  activeDay: string = 'Day 1';
  
  // Time slots
  timeSlots: string[] = [
    '7:30-9:00', '9:00-10:30', '10:30-12:00', '12:00-1:30',
    '1:30-3:00', '3:00-4:30', '4:30-6:00', '6:00-7:30'
  ];
  
  // Term selection
  activeTerm: string = '';
  combinedOptions: { label: string, value: string }[] = [];
  termOptions = [
    { key: 1, value: '1st Semester' },
    { key: 2, value: '2nd Semester' },
    { key: 3, value: 'Summer' },
  ];
  
  // UI state
  editingRow: number | null = null;
  editedExam: ScheduledExam | null = null;
  toast: ToastMessage | null = null;
  movePopupVisible = false;
  moveExamData: any = null;
  safeSlots: SafeSlotOption[] = [];
  showExamGroupManager: boolean = false;
  
  // Exam groups
  savedExamGroups: ExamGroup[] = [];
  selectedExamGroup: ExamGroup | null = null;
  
  // View data
  courseSummary: any[] = [];
  roomTimeData: any = { table: {}, rooms: [], days: [] };
  courseGridData: any = { grid: {}, courses: [], days: [] };

  constructor(
    public api: ApiService,
    public global: GlobalService,
    private dialog: MatDialog,
    private cdr: ChangeDetectorRef,
    private http: HttpClient,
    private sharedData: SharedDataService
  ) {}

  ngOnInit() {
    this.activeDay = this.days[0];
    this.roomTimeData.days = [...this.days];
    this.courseGridData.days = [...this.days];
    this.combineYearTerm();
    
    // Clear selection on page refresh
    this.sharedData.clearSelectedExamGroup();
    this.sharedData.clearExamDates();
    this.sharedData.clearActiveTerm();
    this.selectedExamGroup = null;
    
    this.loadSavedExamGroups();
    
    // Subscribe to future group selections
    this.sharedData.selectedExamGroup$.subscribe(group => {
      if (group) {
        this.selectedExamGroup = group;
        this.examDates = group.days.map(d => 
          d.date ? new Date(d.date).toLocaleDateString('en-CA') : ''
        );
        this.activeTerm = group.termYear || '';
      }
    });
  }

  // ===== Initialization Methods =====
  
  combineYearTerm() {
    const currentYear = new Date().getFullYear();
    for (let y = currentYear - 1; y <= currentYear + 1; y++) {
      const nextYear = y + 1;
      for (const t of this.termOptions) {
        const label = `${t.value} SY ${y}-${nextYear}`;
        const value = `${y}${nextYear.toString().slice(-2)}${t.key}`;
        this.combinedOptions.push({ label, value });
      }
    }
  }

  loadSavedExamGroups() {
    const stored = localStorage.getItem('examGroups');
    this.savedExamGroups = stored ? JSON.parse(stored) : [];
  }

  // ===== Exam Group Management =====
  
  toggleExamGroupManager() {
    this.showExamGroupManager = !this.showExamGroupManager;
  }

  selectExamGroup(group: ExamGroup) {
    this.selectedExamGroup = group;
    this.activeTerm = group.termYear || '';
    
    this.examDates = group.days
      .map(d => d.date ? new Date(d.date).toLocaleDateString('en-CA') : '')
      .filter(d => d !== '');
    
    this.days = this.examDates.map((_, i) => `Day ${i + 1}`);
    
    this.sharedData.setSelectedExamGroup(group);
    this.sharedData.setExamDates(group.days);
    if (group.termYear) this.sharedData.setActiveTerm(group.termYear);
    
    // Check for saved schedule
    if (this.hasScheduleForGroup(group.name, group.termYear || '')) {
      Swal.fire({
        title: 'Saved Schedule Found!',
        text: 'This exam group already has a generated schedule. Would you like to load it?',
        type: 'question',
        showCancelButton: true,
        confirmButtonText: '📋 Load Saved Schedule',
        cancelButtonText: '✕ Cancel',
        confirmButtonColor: '#10b981',
        cancelButtonColor: '#6b7280'
      }).then((result: any) => {
        if (result.value) {
          if (this.loadScheduleForGroup(group.name, group.termYear || '')) {
            this.currentStep = 'generate';
            this.showToast('Success', `Loaded saved schedule for "${group.name}"`);
            this.cdr.detectChanges();
          } else {
            this.showToast('Error', 'Failed to load saved schedule');
          }
        } else {
          this.showToast('Success', `Selected "${group.name}" - Ready to load API data`);
        }
      });
    } else {
      this.showToast('Success', `Selected "${group.name}" with ${this.examDates.length} exam days`);
    }
    
    this.showExamGroupManager = false;
  }

  editGroup(group: ExamGroup) {
    const originalData = {
      name: group.name,
      termYear: group.termYear,
      daysCount: group.days.length,
      days: JSON.stringify(group.days)
    };
    
    const dialogRef = this.dialog.open(DatePickerComponent, {
      width: '800px',
      maxHeight: '90vh',
      data: { group, mode: 'edit' }
    });

    dialogRef.afterClosed().subscribe((result) => {
      this.loadSavedExamGroups();
      
      if (result && result.success) {
        const updatedGroup = result.group;
        const datesChanged = 
          originalData.daysCount !== updatedGroup.days.length ||
          originalData.days !== JSON.stringify(updatedGroup.days);
        
        const hasSchedule = this.hasScheduleForGroup(updatedGroup.name, updatedGroup.termYear || '');
        
        if (hasSchedule && datesChanged) {
          Swal.fire({
            title: 'Schedule Needs Update',
            text: `You changed the exam dates for "${updatedGroup.name}". The existing schedule is now outdated. Would you like to regenerate the schedule now?`,
            type: 'question',
            showCancelButton: true,
            confirmButtonText: '🔄 Regenerate Now',
            cancelButtonText: '📋 Keep Old Schedule',
            confirmButtonColor: '#10b981',
            cancelButtonColor: '#6b7280'
          }).then((choice: any) => {
            if (choice.value) {
              this.regenerateScheduleForGroup(updatedGroup);
            } else {
              this.updateScheduleDateMappings(updatedGroup);
              this.showToast('Success', `Schedule kept for "${updatedGroup.name}" with updated dates!`, 'success');
            }
          });
        } else {
          this.showToast('Success', `Updated "${updatedGroup.name}" successfully`);
        }
        
        // Update selected group if it was edited
        if (this.selectedExamGroup && this.selectedExamGroup.name === group.name) {
          const reloadedGroup = this.savedExamGroups.find(g => g.name === updatedGroup.name);
          if (reloadedGroup) {
            this.selectedExamGroup = reloadedGroup;
            this.activeTerm = reloadedGroup.termYear || '';
            this.examDates = reloadedGroup.days
              .map(d => d.date ? new Date(d.date).toLocaleDateString('en-CA') : '')
              .filter(d => d !== '');
            this.days = this.examDates.map((_, i) => `Day ${i + 1}`);
            this.activeDay = this.days[0] || 'Day 1';
            
            this.sharedData.setSelectedExamGroup(reloadedGroup);
            this.sharedData.setExamDates(reloadedGroup.days);
            if (reloadedGroup.termYear) this.sharedData.setActiveTerm(reloadedGroup.termYear);
          }
        }
      }
      
      this.cdr.detectChanges();
    });
  }

  deleteGroup(groupName: string) {
    if (confirm(`Delete exam group "${groupName}"?`)) {
      const groupToDelete = this.savedExamGroups.find(g => g.name === groupName);
      const currentlySelected = this.sharedData.getSelectedExamGroup();
      const isSelectedGroup = currentlySelected && currentlySelected.name === groupName;

      this.savedExamGroups = this.savedExamGroups.filter(g => g.name !== groupName);
      localStorage.setItem('examGroups', JSON.stringify(this.savedExamGroups));
      
      // Delete saved schedule
      if (groupToDelete && groupToDelete.termYear) {
        const scheduleKey = `schedule_${groupName}_${groupToDelete.termYear}`;
        localStorage.removeItem(scheduleKey);
      }
      
      this.loadSavedExamGroups();

      if (isSelectedGroup) {
        this.sharedData.clearExamDates();
        this.sharedData.clearSelectedExamGroup();
        this.sharedData.clearActiveTerm();
        
        if (groupToDelete && groupToDelete.termYear) {
          this.sharedData.clearStudentMappingForGroup(groupName, groupToDelete.termYear);
        }
        
        this.sharedData.clearStudentMapping();
        this.selectedExamGroup = null;
        this.examDates = ['', '', ''];
        this.activeTerm = '';
        
        this.global.swalSuccess(`Deleted "${groupName}". All associated data has been cleared.`);
      } else {
        if (groupToDelete && groupToDelete.termYear) {
          this.sharedData.clearStudentMappingForGroup(groupName, groupToDelete.termYear);
        }
        this.global.swalSuccess(`Deleted "${groupName}".`);
      }
    }
  }

  // ===== Data Loading =====
  
  loadExamData() {
    if (!this.activeTerm) {
      this.global.swalAlertError('Please select a term/year first');
      return;
    }

    this.loadSwal();
    
    this.api.getCodeSummaryReport(this.activeTerm)
      .map((response: any) => response.json())
      .subscribe(
        res => {
          // Store raw data
          this.rawCodes = res.data || [];
          Swal.close();

          // Map ALL exams without filtering
          this.exams = this.rawCodes.map((obj: any) => ({
            code: obj.codeNo || obj.CODE || '',
            version: obj.version || obj.VERSION || '',
            subjectId: obj.subjectId || obj.SUBJECT_ID || '',
            title: obj.subjectTitle || obj.DESCRIPTIVE_TITLE || obj.TITLE || '',
            course: (obj.course || obj.COURSE || '').trim(),
            yearLevel: obj.yearLevel || obj.YEAR_LEVEL || obj.year || 1,
            lec: parseInt(obj.lecUnits || obj.LEC_UNITS || obj.lec || '3'),
            oe: parseInt(obj.labUnits || obj.LAB_UNITS || obj.oe || '0'),
            dept: obj.dept || obj.DEPT || obj.department || '',
            instructor: obj.instructor || obj.INSTRUCTOR || obj.instructorName || ''
          }));

          // Extract rooms from ALL data
          this.rooms = this.getUniqueRooms(res.data);
          this.extractRoomCapacities(res.data);
          this.categorizeSubjects();
          
          // Only use fallback if NO rooms found
          if (this.rooms.length === 0) {
            this.rooms = ['A', 'C', 'K', 'L', 'M', 'N'];
          }
          
          this.sharedData.getRoomSummary(res.data);
          this.cdr.detectChanges();
          
          // Show accurate count
          this.showToast('Success', `${this.exams.length} exams loaded from API`);
          console.log('✅ Total exams loaded:', this.exams.length);
          console.log('✅ Total rooms extracted:', this.rooms.length);
        },
        err => {
          Swal.close();
          console.error('❌ API Error:', err);
          this.global.swalAlertError(err);
        }
      );
  }

  getUniqueRooms(data: any[]): string[] {
    if (!data || data.length === 0) {
      console.warn('⚠️ No data provided to getUniqueRooms');
      return [];
    }

    const roomSet = new Set<string>();
    const excludedRooms = [
      'B-11', 'B-12','BTL -','BUL -','HL','J-42','J-43','J-44','J-45','J-46','J-48','K-13',
      'K-14','K-22','K-24','K-41','L-23','M-21','M-31','M-33','M-43','MChem','MLab1','MLab2',
      'Nutri','SMTL','A-102','A-203','A-204','A-205','A-219','A-221','A-225','A-226','A-234',
      'A-302','A-306','A-308','A-309','A-310','A-311','A-312','DemoR','Pharm', 'TBA', 'to be', 
      'Virtu', 'EMC', 'Field', 'Hosp', 'Molec', '', 'null', 'undefined', 'N/A', 'NA'
    ];
    
    console.log('📊 Processing rooms from', data.length, 'records');
    
    data.forEach((item, index) => {
      // Check multiple possible field names (case-insensitive)
      const room = item.roomNumber || item.ROOM_NUMBER || item.ROOM || 
                   item.room || item.roomNo || item.ROOM_NO || 
                   item.roomName || item.ROOM_NAME || '';
      
      if (room) {
        const trimmedRoom = room.toString().trim();
        
        // Only add if not empty and not in exclusion list
        if (trimmedRoom && 
            trimmedRoom.length > 0 && 
            !excludedRooms.includes(trimmedRoom) &&
            trimmedRoom.toLowerCase() !== 'tba' &&
            trimmedRoom.toLowerCase() !== 'to be announced') {
          roomSet.add(trimmedRoom);
        }
      }
    });
    
    const finalRooms = Array.from(roomSet).sort();
    console.log('✅ Extracted', finalRooms.length, 'unique rooms');
    
    // Log first few rooms for debugging
    if (finalRooms.length > 0) {
      console.log('📍 Sample rooms:', finalRooms.slice(0, 10).join(', '));
    }
    
    return finalRooms;
  }

  extractRoomCapacities(data: any[]) {
    this.roomCapacities.clear();
    
    if (!data || data.length === 0) {
      console.warn('⚠️ No data provided to extractRoomCapacities');
      return;
    }
    
    data.forEach(item => {
      // Check multiple possible field names for room
      const room = item.roomNumber || item.ROOM_NUMBER || item.ROOM || 
                   item.room || item.roomNo || item.ROOM_NO || '';
      
      // Check multiple possible field names for capacity
      const capacityValue = item.classSize || item.CLASS_SIZE || item.capacity || 
                           item.CAPACITY || item.roomCapacity || item.ROOM_CAPACITY || '';
      
      if (room && capacityValue) {
        const trimmedRoom = room.toString().trim();
        const capacity = parseInt(capacityValue) || 0;
        
        if (trimmedRoom && capacity > 0) {
          const currentCapacity = this.roomCapacities.get(trimmedRoom);
          // Keep the highest capacity if room appears multiple times
          if (!currentCapacity || currentCapacity < capacity) {
            this.roomCapacities.set(trimmedRoom, capacity);
          }
        }
      }
    });
    
    console.log('✅ Extracted capacities for', this.roomCapacities.size, 'rooms');
  }

  categorizeSubjects() {
    this.subjectTypes.clear();
    const subjectCourseCount = new Map<string, Set<string>>();
    
    this.exams.forEach(exam => {
      if (!subjectCourseCount.has(exam.subjectId)) {
        subjectCourseCount.set(exam.subjectId, new Set());
      }
      const courses = subjectCourseCount.get(exam.subjectId);
      if (courses) {
        courses.add(exam.course);
      }
    });
    
    subjectCourseCount.forEach((courses, subjectId) => {
      this.subjectTypes.set(subjectId, courses.size >= 15 ? 'genEd' : 'major');
    });
  }


  // ===== Schedule Generation =====
  
  generateExamSchedule() {
    if (this.exams.length === 0) {
      this.showToast('Error', 'Please import exams first', 'destructive');
      return;
    }

    if (this.examDates.some(d => !d)) {
      this.showToast('Error', 'Please set all exam dates first', 'destructive');
      return;
    }

    Swal.fire({
      title: 'Choose Generation Method',
      html: `
        <div style="text-align: left; padding: 10px;">
          <p><strong>Basic Algorithm:</strong></p>
          <ul style="margin-left: 20px; font-size: 14px;">
            <li>Fast generation</li>
            <li>Simple rules</li>
            <li>Good for drafts</li>
          </ul>
          <br>
          <p><strong>Enhanced Algorithm:</strong></p>
          <ul style="margin-left: 20px; font-size: 14px;">
            <li>1.5-hour breaks enforced</li>
            <li>Gen-Ed NOT at 7:30 AM</li>
            <li>No back-to-back majors</li>
            <li>Even distribution</li>
            <li>Capacity-aware rooms</li>
          </ul>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Enhanced Algorithm',
      cancelButtonText: 'Basic Algorithm'
    }).then((result) => {
      if (result.value) {
        this.generateEnhancedSchedule();
      } else if (result.dismiss === Swal.DismissReason.cancel) {
        this.generateBasicSchedule();
      }
    });
  }

  generateBasicSchedule() {
    const schedule: ScheduledExam[] = [];
    const courseGroups: { [course: string]: Exam[] } = {};
    
    this.exams.forEach(exam => {
      const course = exam.course.toUpperCase().trim();
      if (!courseGroups[course]) courseGroups[course] = [];
      courseGroups[course].push(exam);
    });

    const usedRoomsBySlot: { [key: string]: Set<string> } = {};
    const courseLastSlot: { [course: string]: number } = {};
    const subjectIdSlot: { [subjectId: string]: { day: string; slots: string[] } } = {};
    const sameExamDay: { [key: string]: string } = {};
    let slotIndex = 0;

    for (const course of Object.keys(courseGroups)) {
      const courseExams = courseGroups[course];
      const totalExams = courseExams.length;

      const allowedDays = totalExams <= 3 ? [this.days[0]] :
                          totalExams <= 6 ? [this.days[0], this.days[1]] :
                          [...this.days];

      let dayIndex = 0;

      for (const exam of courseExams) {
        const subjectId = exam.subjectId.toUpperCase().trim();
        const title = exam.title.toUpperCase().trim();
        const examKey = `${course}_${title}`;
        const slotsNeeded = (exam.lec + exam.oe >= 5) ? 2 : 1;

        let day = sameExamDay[examKey] || allowedDays[dayIndex % allowedDays.length];
        sameExamDay[examKey] = day;
        if (!sameExamDay[examKey]) dayIndex++;

        let slots: string[] = [];
        if (subjectIdSlot[subjectId]) {
          day = subjectIdSlot[subjectId].day;
          slots = subjectIdSlot[subjectId].slots;
        } else {
          if (subjectId.includes('CFED')) {
            const allowedSlots = this.timeSlots.filter(t => !t.startsWith('7:30'));
            for (let i = 0; i < slotsNeeded; i++) {
              slots.push(allowedSlots[(slotIndex + i) % allowedSlots.length]);
            }
            slotIndex += slotsNeeded;
          } else {
            let attempts = 0;
            while (slots.length < slotsNeeded) {
              const slot = this.timeSlots[slotIndex % this.timeSlots.length];
              slotIndex++;
              attempts++;
              if (attempts > this.timeSlots.length * 3 ||
                  courseLastSlot[course] === undefined ||
                  Math.abs(this.timeSlots.indexOf(slot) - courseLastSlot[course]) > 1) {
                slots.push(slot);
              }
            }
          }
          subjectIdSlot[subjectId] = { day, slots };
        }

        courseLastSlot[course] = this.timeSlots.indexOf(slots[slots.length - 1]);

        slots.forEach(slot => {
          const slotKey = `${day}|${slot}`;
          if (!usedRoomsBySlot[slotKey]) usedRoomsBySlot[slotKey] = new Set<string>();

          const availableRoom = this.assignRoomByDepartment(exam, usedRoomsBySlot[slotKey], this.rooms);

          if (availableRoom) {
            usedRoomsBySlot[slotKey].add(availableRoom);
            schedule.push({
              CODE: exam.code,
              SUBJECT_ID: exam.subjectId,
              DESCRIPTIVE_TITLE: exam.title,
              COURSE: exam.course,
              YEAR_LEVEL: exam.yearLevel,
              INSTRUCTOR: exam.instructor,
              DEPT: exam.dept,
              OE: exam.oe,
              DAY: day,
              SLOT: slot,
              ROOM: availableRoom
            });
          }
        });
      }
    }

    this.generatedSchedule = schedule;
    this.currentStep = 'generate';
    
    if (this.selectedExamGroup && this.activeTerm) {
      this.saveScheduleForGroup(this.selectedExamGroup.name, this.activeTerm);
    }
    
    this.showToast('Schedule Generated', `${schedule.length} exams scheduled successfully (Basic Algorithm)`);
  }

  generateEnhancedSchedule() {
    Swal.fire({
      title: 'Processing',
      text: 'Generating schedule with all constraints...',
      allowOutsideClick: false,
      allowEscapeKey: false,
      onOpen: () => Swal.showLoading()
    });

    setTimeout(() => {
      try {
        const subjectGroups = this.groupSubjectsBySharedId();
        const sortedSubjects = this.prioritizeSubjects(subjectGroups);
        const targets = this.calculateTargets();
        const result = this.assignWithAllConstraints(sortedSubjects, targets);
        
        Swal.close();
        
        if (this.selectedExamGroup && this.activeTerm) {
          this.saveScheduleForGroup(this.selectedExamGroup.name, this.activeTerm);
        }
        
        setTimeout(() => {
          this.currentStep = 'generate';
          let dayMsg = `Day 1: ${result.day1} subjects`;
          if (result.day2 > 0) dayMsg += `, Day 2: ${result.day2} subjects`;
          if (result.day3 > 0) dayMsg += `, Day 3: ${result.day3} subjects`;
          
          this.showToast('Schedule Generated', `${result.assigned} subjects assigned! ${dayMsg} (Enhanced Algorithm)`);
        }, 100);

      } catch (error) {
        Swal.close();
        setTimeout(() => {
          this.global.swalAlertError(`Generation error: ${error.message || 'Unknown error'}`);
        }, 100);
      }
    }, 300);
  }

  private groupSubjectsBySharedId(): Map<string, Exam[]> {
    const groups = new Map<string, Exam[]>();
    this.exams.forEach(exam => {
      if (!groups.has(exam.subjectId)) groups.set(exam.subjectId, []);
      const examList = groups.get(exam.subjectId);
      if (examList) {
        examList.push(exam);
      }
    });
    return groups;
  }

  private prioritizeSubjects(groups: Map<string, Exam[]>): Array<any> {
    const subjects: Array<any> = [];
    
    for (const [subjectId, exams] of groups.entries()) {
      subjects.push({
        subjectId,
        exams,
        units: exams[0].lec + exams[0].oe,
        type: this.subjectTypes.get(subjectId) || 'major',
        count: exams.length
      });
    }
    
    subjects.sort((a, b) => {
      if (a.units !== b.units) return b.units - a.units;
      if (a.count !== b.count) return b.count - a.count;
      if (a.type !== b.type) return a.type === 'genEd' ? -1 : 1;
      return a.subjectId.localeCompare(b.subjectId);
    });
    
    return subjects;
  }

  private calculateTargets(): Map<string, number[]> {
    const targets = new Map<string, number[]>();
    const numDays = this.days.length;
    const isSummer = this.activeTerm && this.activeTerm.endsWith('3');
    const maxPerDay = isSummer ? 6 : 4;
    
    const courseGroups = new Map<string, Exam[]>();
    this.exams.forEach(exam => {
      const key = `${exam.course}_${exam.yearLevel}`;
      if (!courseGroups.has(key)) courseGroups.set(key, []);
      const examList = courseGroups.get(key);
      if (examList) {
        examList.push(exam);
      }
    });
    
    for (const [key, exams] of courseGroups.entries()) {
      const uniqueSubjects = new Set(exams.map(e => e.subjectId));
      const total = uniqueSubjects.size;
      const perDay = Math.ceil(total / numDays);
      const targetArr: number[] = new Array(numDays).fill(Math.min(perDay, maxPerDay));
      targets.set(key, targetArr);
    }
    
    return targets;
  }

  private assignWithAllConstraints(sortedSubjects: Array<any>, targets: Map<string, number[]>): any {
    const assigned = new Set<string>();
    const slotMap = new Map<string, {day: string, slot: string}>();
    const dayCount = new Map<string, Map<string, number>>();
    const dayMajors = new Map<string, Map<string, Set<string>>>();
    const schedule: ScheduledExam[] = [];
    const usedRoomsBySlot: { [key: string]: Set<string> } = {};
    
    // Initialize counters
    const courseKeys = new Set(this.exams.map(e => `${e.course}_${e.yearLevel}`));
    for (const key of courseKeys) {
      dayCount.set(key, new Map(this.days.map(d => [d, 0])));
      dayMajors.set(key, new Map(this.days.map(d => [d, new Set()])));
    }
    
    for (const subject of sortedSubjects) {
      if (assigned.has(subject.subjectId)) continue;
      
      if (slotMap.has(subject.subjectId)) {
        const existing = slotMap.get(subject.subjectId);
        if (existing) {
          this.assignSubjectToSchedule(subject, existing.day, existing.slot, schedule, usedRoomsBySlot, dayCount, dayMajors);
          assigned.add(subject.subjectId);
          continue;
        }
      }
      
      const slot = this.findBestSlotStrict(subject, dayCount, dayMajors, targets);
      
      if (slot) {
        this.assignSubjectToSchedule(subject, slot.day, slot.slot, schedule, usedRoomsBySlot, dayCount, dayMajors);
        slotMap.set(subject.subjectId, slot);
        assigned.add(subject.subjectId);
      }
    }
    
    this.generatedSchedule = schedule;
    
    return {
      success: assigned.size === sortedSubjects.length,
      assigned: assigned.size,
      total: sortedSubjects.length,
      day1: this.countDayAssignments(dayCount, 0),
      day2: this.days.length > 1 ? this.countDayAssignments(dayCount, 1) : 0,
      day3: this.days.length > 2 ? this.countDayAssignments(dayCount, 2) : 0
    };
  }

  private findBestSlotStrict(
    subject: any,
    dayCount: Map<string, Map<string, number>>,
    dayMajors: Map<string, Map<string, Set<string>>>,
    targets: Map<string, number[]>
  ): {day: string, slot: string} | null {
    
    const dayScores = this.calculateDayPreference(subject.exams, dayCount, targets);
    
    for (const {day} of dayScores) {
      const slotOrder = this.getDistributedSlotOrder(day);
      
      for (const slotIndex of slotOrder) {
        const slot = this.timeSlots[slotIndex];
        
        if (subject.type === 'genEd' && slot === '7:30-9:00') continue;
        
        if (this.checkAllConstraints(subject, day, slot, dayCount, dayMajors)) {
          return { day, slot };
        }
      }
    }
    
    return null;
  }

  private calculateDayPreference(
    exams: Exam[],
    dayCount: Map<string, Map<string, number>>,
    targets: Map<string, number[]>
  ): Array<{day: string, dayIndex: number, score: number}> {
    
    const scores: Array<any> = [];
    
    for (let i = 0; i < this.days.length; i++) {
      const day = this.days[i];
      let score = 0;
      
      for (const exam of exams) {
        const key = `${exam.course}_${exam.yearLevel}`;
        const dayCountMap = dayCount.get(key);
        const current = (dayCountMap && dayCountMap.get(day)) || 0;
        const targetArr = targets.get(key);
        const target = (targetArr && targetArr[i]) || 4;
        
        score += current < target ? (target - current) * 100 : -(current - target) * 50;
      }
      
      scores.push({ day, dayIndex: i, score });
    }
    
    scores.sort((a, b) => b.score - a.score);
    return scores;
  }

  private getDistributedSlotOrder(day: string): number[] {
    const slotCounts: number[] = new Array(this.timeSlots.length).fill(0);
    
    this.generatedSchedule.forEach(exam => {
      if (exam.DAY === day) {
        const idx = this.timeSlots.indexOf(exam.SLOT);
        if (idx >= 0) slotCounts[idx]++;
      }
    });
    
    return this.timeSlots
      .map((slot, index) => ({ index, count: slotCounts[index] }))
      .sort((a, b) => a.count !== b.count ? a.count - b.count : a.index - b.index)
      .map(s => s.index);
  }

  private checkAllConstraints(
    subject: any,
    day: string,
    slot: string,
    dayCount: Map<string, Map<string, number>>,
    dayMajors: Map<string, Map<string, Set<string>>>
  ): boolean {
    
    const slotIdx = this.timeSlots.indexOf(slot);
    const isSummer = this.activeTerm && this.activeTerm.endsWith('3');
    const maxPerDay = isSummer ? 6 : 4;
    
    for (const exam of subject.exams) {
      const key = `${exam.course}_${exam.yearLevel}`;
      const dayCountMap = dayCount.get(key);
      const count = (dayCountMap && dayCountMap.get(day)) || 0;
      
      if (count >= maxPerDay) return false;
      
      if (count >= maxPerDay) return false;
      
      // Check consecutive slots
      if (slotIdx > 0) {
        const prevSlot = this.timeSlots[slotIdx - 1];
        if (this.generatedSchedule.some(e => 
          e.DAY === day && e.SLOT === prevSlot && 
          e.COURSE === exam.course && e.YEAR_LEVEL === exam.yearLevel
        )) return false;
      }
      
      if (slotIdx + 1 < this.timeSlots.length) {
        const nextSlot = this.timeSlots[slotIdx + 1];
        if (this.generatedSchedule.some(e => 
          e.DAY === day && e.SLOT === nextSlot && 
          e.COURSE === exam.course && e.YEAR_LEVEL === exam.yearLevel
        )) return false;
      }
      
      // Check major back-to-back
      if (subject.type === 'major') {
        if (slotIdx > 0) {
          const prevSlot = this.timeSlots[slotIdx - 1];
          const prevExam = this.generatedSchedule.find(e => 
            e.DAY === day && e.SLOT === prevSlot && 
            e.COURSE === exam.course && e.YEAR_LEVEL === exam.yearLevel
          );
          if (prevExam && this.subjectTypes.get(prevExam.SUBJECT_ID) === 'major') {
            return false;
          }
        }
        
        if (slotIdx + 2 < this.timeSlots.length) {
          const slot2Ahead = this.timeSlots[slotIdx + 2];
          const exam2Ahead = this.generatedSchedule.find(e => 
            e.DAY === day && e.SLOT === slot2Ahead && 
            e.COURSE === exam.course && e.YEAR_LEVEL === exam.yearLevel
          );
          if (exam2Ahead && this.subjectTypes.get(exam2Ahead.SUBJECT_ID) === 'major') {
            return false;
          }
        }
      }
    }
    
    return true;
  }

  private assignSubjectToSchedule(
    subject: any,
    day: string,
    slot: string,
    schedule: ScheduledExam[],
    usedRoomsBySlot: { [key: string]: Set<string> },
    dayCount: Map<string, Map<string, number>>,
    dayMajors: Map<string, Map<string, Set<string>>>
  ): void {
    
    const slotKey = `${day}|${slot}`;
    if (!usedRoomsBySlot[slotKey]) usedRoomsBySlot[slotKey] = new Set<string>();
    
    for (const exam of subject.exams) {
      const availableRoom = this.assignRoomByDepartment(exam, usedRoomsBySlot[slotKey], this.rooms);
      
      if (availableRoom) {
        usedRoomsBySlot[slotKey].add(availableRoom);
        
        schedule.push({
          CODE: exam.code,
          SUBJECT_ID: exam.subjectId,
          DESCRIPTIVE_TITLE: exam.title,
          COURSE: exam.course,
          YEAR_LEVEL: exam.yearLevel,
          INSTRUCTOR: exam.instructor,
          DEPT: exam.dept,
          OE: exam.oe,
          DAY: day,
          SLOT: slot,
          ROOM: availableRoom
        });
        
        if (subject.units === 6) {
          const nextSlot = this.getNextSlot(slot);
          if (nextSlot) {
            const nextSlotKey = `${day}|${nextSlot}`;
            if (!usedRoomsBySlot[nextSlotKey]) usedRoomsBySlot[nextSlotKey] = new Set<string>();
            usedRoomsBySlot[nextSlotKey].add(availableRoom);
            
            schedule.push({
              CODE: exam.code,
              SUBJECT_ID: exam.subjectId,
              DESCRIPTIVE_TITLE: exam.title,
              COURSE: exam.course,
              YEAR_LEVEL: exam.yearLevel,
              INSTRUCTOR: exam.instructor,
              DEPT: exam.dept,
              OE: exam.oe,
              DAY: day,
              SLOT: nextSlot,
              ROOM: availableRoom
            });
          }
        }
        
        const key = `${exam.course}_${exam.yearLevel}`;
        const dayCountMap = dayCount.get(key);
        const count = (dayCountMap && dayCountMap.get(day)) || 0;
        if (dayCountMap) {
          dayCountMap.set(day, count + 1);
        }
        
        if (subject.type === 'major') {
          const dayMajorsMap = dayMajors.get(key);
          if (dayMajorsMap) {
            const majorsSet = dayMajorsMap.get(day);
            if (majorsSet) {
              majorsSet.add(subject.subjectId);
            }
          }
        }
      }
    }
  }

  private getNextSlot(slot: string): string | null {
    const idx = this.timeSlots.indexOf(slot);
    return (idx >= 0 && idx + 1 < this.timeSlots.length) ? this.timeSlots[idx + 1] : null;
  }

  private countDayAssignments(dayCount: Map<string, Map<string, number>>, dayIndex: number): number {
    const day = this.days[dayIndex];
    return new Set(this.generatedSchedule.filter(e => e.DAY === day).map(e => e.SUBJECT_ID)).size;
  }

  assignRoomByDepartment(exam: Exam, usedRoomsSet: Set<string>, roomsList: string[]): string | null {
    const dept = exam.dept ? exam.dept.toUpperCase() : '';
    const course = exam.course ? exam.course.toUpperCase() : '';

    let preferredPrefixes: string[] = [];

    if (dept === 'SABH' || dept === 'SECAP') {
      preferredPrefixes = ['A'];
    } else if (course.startsWith('BSA')) {
      preferredPrefixes = ['C', 'K'];
    } else if (dept === 'SACE') {
      preferredPrefixes = ['N', 'K'];
    } else if (dept === 'SHAS') {
      preferredPrefixes = ['M', 'L'];
    }

    const availableRooms = roomsList
      .filter(r => !usedRoomsSet.has(r))
      .sort((a, b) => (this.roomCapacities.get(b) || 0) - (this.roomCapacities.get(a) || 0));

    return availableRooms.find(r => preferredPrefixes.some(prefix => r.startsWith(prefix))) || availableRooms[0] || null;
  }


  // ===== Schedule Regeneration =====
  
  regenerateScheduleForGroup(group: ExamGroup) {
    this.selectedExamGroup = group;
    this.activeTerm = group.termYear || '';
    this.examDates = group.days.map(d => d.date ? new Date(d.date).toLocaleDateString('en-CA') : '').filter(d => d !== '');
    this.days = this.examDates.map((_, i) => `Day ${i + 1}`);
    this.activeDay = this.days[0] || 'Day 1';
    
    this.sharedData.setSelectedExamGroup(group);
    this.sharedData.setExamDates(group.days);
    if (group.termYear) this.sharedData.setActiveTerm(group.termYear);
    
    if (this.exams.length > 0 && this.rooms.length > 0) {
      this.clearScheduleForGroup(group.name, group.termYear || '');
      this.generateExamSchedule();
    } else {
      Swal.fire({
        title: 'Load Exam Data First',
        html: '<p>To regenerate the schedule, you need to load exam data from the API first.</p><br><p>Would you like to load the data now?</p>',
        showCancelButton: true,
        confirmButtonText: 'Load Data Now',
        cancelButtonText: 'Cancel',
        confirmButtonColor: '#3b82f6'
      }).then((choice) => {
        if (choice.value) {
          this.currentStep = 'import';
          this.showToast('Info', 'Click "Load Exam Data from API" to load data, then generate schedule', 'info');
        }
      });
    }
  }

  clearScheduleForGroup(groupName: string, termYear: string) {
    const key = `schedule_${groupName}_${termYear}`;
    localStorage.removeItem(key);
    
    if (this.selectedExamGroup && this.selectedExamGroup.name === groupName) {
      this.generatedSchedule = [];
      this.courseSummary = [];
      this.roomTimeData = { table: {}, rooms: [], days: [] };
      this.courseGridData = { grid: {}, courses: [], days: [] };
      
      if (['generate', 'summary', 'timetable', 'coursegrid'].includes(this.currentStep)) {
        this.currentStep = 'import';
      }
    }
  }

  updateScheduleDateMappings(group: ExamGroup) {
    const key = `schedule_${group.name}_${group.termYear}`;
    const saved = localStorage.getItem(key);
    if (!saved) return;
    
    try {
      const scheduleData = JSON.parse(saved);
      const newExamDates = group.days.map(d => d.date ? new Date(d.date).toLocaleDateString('en-CA') : '').filter(d => d !== '');
      
      scheduleData.examDates = newExamDates;
      scheduleData.lastUpdated = new Date().toISOString();
      localStorage.setItem(key, JSON.stringify(scheduleData));
      
      if (this.selectedExamGroup && this.selectedExamGroup.name === group.name) {
        this.examDates = newExamDates;
        this.days = this.examDates.map((_, i) => `Day ${i + 1}`);
        this.activeDay = this.days[0] || 'Day 1';
        this.roomTimeData.days = [...this.days];
        this.courseGridData.days = [...this.days];
        this.cdr.detectChanges();
      }
    } catch (error) {
      console.error('Error updating date mappings:', error);
    }
  }

  // ===== Storage Management =====
  
  private saveScheduleForGroup(groupName: string, termYear: string) {
    const key = `schedule_${groupName}_${termYear}`;
    const scheduleData = {
      generatedSchedule: this.generatedSchedule,
      exams: this.exams,
      rooms: this.rooms,
      roomCapacities: Array.from(this.roomCapacities.entries()),
      examDates: this.examDates,
      subjectTypes: Array.from(this.subjectTypes.entries()),
      timestamp: new Date().toISOString()
    };
    localStorage.setItem(key, JSON.stringify(scheduleData));
  }

  private loadScheduleForGroup(groupName: string, termYear: string): boolean {
    const key = `schedule_${groupName}_${termYear}`;
    const saved = localStorage.getItem(key);
    if (!saved) return false;

    try {
      const scheduleData = JSON.parse(saved);
      this.generatedSchedule = scheduleData.generatedSchedule || [];
      this.exams = scheduleData.exams || [];
      this.rooms = scheduleData.rooms || [];
      this.examDates = scheduleData.examDates || [];
      
      if (scheduleData.roomCapacities) this.roomCapacities = new Map(scheduleData.roomCapacities);
      if (scheduleData.subjectTypes) this.subjectTypes = new Map(scheduleData.subjectTypes);
      
      this.days = this.examDates.map((_, i) => `Day ${i + 1}`);
      this.activeDay = this.days[0] || 'Day 1';
      this.cdr.detectChanges();
      
      return true;
    } catch (err) {
      return false;
    }
  }

  hasScheduleForGroup(groupName: string, termYear: string): boolean {
    return !!localStorage.getItem(`schedule_${groupName}_${termYear}`);
  }

  saveToLocalStorage() {
    const dataToSave = {
      activeTerm: this.activeTerm,
      exams: this.exams,
      rooms: this.rooms,
      generatedSchedule: this.generatedSchedule,
      examDates: this.examDates,
      currentStep: this.currentStep,
      selectedExamGroup: this.selectedExamGroup
    };
    localStorage.setItem('examScheduleData', JSON.stringify(dataToSave));
    
    if (this.selectedExamGroup && this.activeTerm) {
      this.saveScheduleForGroup(this.selectedExamGroup.name, this.activeTerm);
      this.sharedData.setStudentMappingForGroup(
        this.selectedExamGroup.name,
        this.activeTerm,
        this.convertScheduleToMappingFormat()
      );
    }
    
    this.global.swalSuccess("Schedule saved to local storage!");
  }

  private convertScheduleToMappingFormat(): any[] {
    return this.examDates.map(date => ({
      date,
      programs: Array.from(
        this.generatedSchedule
          .filter(e => e.DAY === this.days[this.examDates.indexOf(date)])
          .reduce((map, exam) => {
            const key = `${exam.COURSE}_${exam.YEAR_LEVEL}`;
            if (!map.has(key)) {
              map.set(key, {
                program: exam.COURSE,
                year: exam.YEAR_LEVEL,
                subjects: []
              });
            }
            map.get(key).subjects.push({
              subjectId: exam.SUBJECT_ID,
              subjectTitle: exam.DESCRIPTIVE_TITLE,
              codeNo: exam.CODE,
              sched: exam.SLOT
            });
            return map;
          }, new Map()).values()
      )
    }));
  }

  // ===== View Generation =====
  
  generateCourseSummaryData() {
    const summaryMap: { [course: string]: ScheduledExam[] } = {};
    this.generatedSchedule.forEach(exam => {
      if (!summaryMap[exam.COURSE]) summaryMap[exam.COURSE] = [];
      summaryMap[exam.COURSE].push(exam);
    });

    this.courseSummary = Object.keys(summaryMap).sort().map(course => {
      const courseExams = summaryMap[course].sort((a, b) => {
        if (a.YEAR_LEVEL !== b.YEAR_LEVEL) return a.YEAR_LEVEL - b.YEAR_LEVEL;
        if (a.DAY !== b.DAY) return a.DAY.localeCompare(b.DAY);
        return a.SLOT.localeCompare(b.SLOT);
      });

      const yearLevelGroups: { [yearLevel: number]: any[] } = {};
      
      courseExams.forEach(exam => {
        const yearLevel = exam.YEAR_LEVEL || 1;
        if (!yearLevelGroups[yearLevel]) yearLevelGroups[yearLevel] = [];
        
        let group = yearLevelGroups[yearLevel].find(g => g.day === exam.DAY && g.slot === exam.SLOT);
        if (!group) {
          group = { day: exam.DAY, slot: exam.SLOT, exams: [] };
          yearLevelGroups[yearLevel].push(group);
        }
        group.exams.push(exam);
      });

      return {
        course,
        yearLevelGroups: Object.keys(yearLevelGroups)
          .map(Number)
          .sort((a, b) => a - b)
          .map(yearLevel => ({ yearLevel, groups: yearLevelGroups[yearLevel] }))
      };
    });
  }

  viewCourseSummary() {
    this.generateCourseSummaryData();
    this.currentStep = 'summary';
  }

  generateRoomTimeTableData() {
    const uniqueRooms = Array.from(new Set(this.generatedSchedule.map(e => e.ROOM))).sort();
    const uniqueDays = Array.from(new Set(this.generatedSchedule.map(e => e.DAY)));

    const table: any = {};
    uniqueDays.forEach(day => {
      table[day] = {};
      uniqueRooms.forEach(room => {
        table[day][room] = {};
        this.timeSlots.forEach(slot => {
          table[day][room][slot] = null;
        });
      });
    });

    this.generatedSchedule.forEach(exam => {
      table[exam.DAY][exam.ROOM][exam.SLOT] = {
        code: exam.CODE,
        course: exam.COURSE,
        yearLevel: exam.YEAR_LEVEL || 1,
        dept: exam.DEPT,
        title: exam.DESCRIPTIVE_TITLE
      };
    });

    this.roomTimeData = { table, rooms: uniqueRooms, days: uniqueDays };
    this.activeDay = uniqueDays[0] || 'Day 1';
  }

  viewRoomTimeTable() {
    this.generateRoomTimeTableData();
    this.currentStep = 'timetable';
  }

  generateCourseGridData() {
    const uniqueCourses = Array.from(new Set(this.generatedSchedule.map(e => e.COURSE))).sort();
    const uniqueDays = Array.from(new Set(this.generatedSchedule.map(e => e.DAY)));

    const grid: any = {};
    uniqueDays.forEach(day => {
      grid[day] = {};
      uniqueCourses.forEach(course => {
        grid[day][course] = {};
        this.timeSlots.forEach(slot => {
          grid[day][course][slot] = [];
        });
      });
    });

    this.generatedSchedule.forEach(exam => {
      if (!grid[exam.DAY][exam.COURSE][exam.SLOT]) {
        grid[exam.DAY][exam.COURSE][exam.SLOT] = [];
      }
      grid[exam.DAY][exam.COURSE][exam.SLOT].push({
        subjectId: exam.SUBJECT_ID,
        title: exam.DESCRIPTIVE_TITLE,
        code: exam.CODE,
        room: exam.ROOM,
        dept: exam.DEPT,
        yearLevel: exam.YEAR_LEVEL || 1
      });
    });

    uniqueDays.forEach(day => {
      uniqueCourses.forEach(course => {
        this.timeSlots.forEach(slot => {
          if (grid[day][course][slot].length > 0) {
            grid[day][course][slot].sort((a: any, b: any) => a.yearLevel - b.yearLevel);
          }
        });
      });
    });

    this.courseGridData = { grid, courses: uniqueCourses, days: uniqueDays };
  }

  viewCourseGrid() {
    this.generateCourseGridData();
    this.currentStep = 'coursegrid';
    this.cdr.detectChanges();
  }

  // ===== Editing Methods =====
  
  startEdit(index: number) {
    this.editingRow = index;
    this.editedExam = { ...this.generatedSchedule[index] };
  }

  cancelEdit() {
    this.editingRow = null;
    this.editedExam = null;
  }

  saveEdit() {
    if (this.editingRow !== null && this.editedExam) {
      this.generatedSchedule[this.editingRow] = this.editedExam;
      this.editingRow = null;
      this.editedExam = null;
      this.showToast('Saved', 'Exam updated successfully');
    }
  }

  updateEditField(field: keyof ScheduledExam, value: any) {
    if (this.editedExam) {
      (this.editedExam as any)[field] = value;
    }
  }

  // ===== Exam Moving =====
  
  showMoveOptions(exam: ScheduledExam, day: string, slot: string) {
    if (!exam) {
      this.showToast('Error', 'Exam not found', 'destructive');
      return;
    }

    const group = this.generatedSchedule.filter(e => 
      e.SUBJECT_ID.toUpperCase().trim() === exam.SUBJECT_ID.toUpperCase().trim()
    );

    this.moveExamData = { examRef: exam, groupExams: group };
    this.safeSlots = this.findSafeSlotsForGroup(group);
    this.movePopupVisible = true;
  }

  closeMovePopup() {
    this.movePopupVisible = false;
  }

  applyMove(newDay: string, newSlot: string) {
    if (!this.moveExamData || !this.moveExamData.groupExams) {
      this.showToast('Error', 'No exams selected to move', 'destructive');
      return;
    }

    const group = this.moveExamData.groupExams;

    for (let exam of group) {
      exam.DAY = newDay;
      exam.SLOT = newSlot;

      const occupiedRooms = this.generatedSchedule
        .filter(e => e.DAY === newDay && e.SLOT === newSlot && e !== exam)
        .map(e => e.ROOM);

      const availableRoom = this.rooms.find(r => !occupiedRooms.includes(r));
      if (availableRoom) exam.ROOM = availableRoom;
    }

    if (this.currentStep === 'coursegrid') {
      this.generateCourseGridData();
    }

    this.movePopupVisible = false;
    this.showToast('Updated', `${group.length} exams moved to ${newDay} ${newSlot}`);
  }

  findSafeSlotsForGroup(group: ScheduledExam[]): SafeSlotOption[] {
    const safe: SafeSlotOption[] = [];

    for (let day of this.days) {
      for (let slot of this.timeSlots) {
        const safeForAll = group.every(exam => this.isSlotSafeForExam(exam, day, slot));

        if (safeForAll) {
          const usedRooms = new Set(
            this.generatedSchedule
              .filter(e => e.DAY === day && e.SLOT === slot && !group.includes(e))
              .map(e => e.ROOM)
          );

          group.forEach(e => usedRooms.delete(e.ROOM));
          const availableRooms = this.rooms.filter(r => !usedRooms.has(r));
          
          if (availableRooms.length >= group.length) {
            safe.push({ day, slot, availableRooms: availableRooms.slice(0, group.length) });
          }
        }
      }
    }

    return safe;
  }

  isSlotSafeForExam(exam: ScheduledExam, day: string, slot: string) {
    return !this.generatedSchedule.some(e =>
      e.DAY === day &&
      e.SLOT === slot &&
      e.COURSE === exam.COURSE &&
      e.SUBJECT_ID !== exam.SUBJECT_ID
    );
  }

  getFullExam(gridExam: any, day: string, slot: string): ScheduledExam | undefined {
    return this.generatedSchedule.find(e =>
      e.CODE === gridExam.code && e.DAY === day && e.SLOT === slot
    );
  }

  // ===== Utility Methods =====
  
  downloadScheduleCSV() {
    if (this.generatedSchedule.length === 0) return;

    const headers = ['Code', 'Subject ID', 'Title', 'Course', 'Year Level', 'Instructor', 'Dept', 'Day', 'Time', 'Room'];
    const csv = [
      headers.join(','),
      ...this.generatedSchedule.map(item => [
        item.CODE, item.SUBJECT_ID, item.DESCRIPTIVE_TITLE, item.COURSE,
        item.YEAR_LEVEL, item.INSTRUCTOR, item.DEPT, item.DAY, item.SLOT, item.ROOM
      ].join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const groupName = (this.selectedExamGroup && this.selectedExamGroup.name) || 'export';
    saveAs(blob, `exam_schedule_${groupName}.csv`);
  }

  getDeptColor(dept: string): string {
    const colors: { [key: string]: string } = {
      'SACE': '#ef4444',
      'SABH': '#facc15',
      'SECAP': '#3b82f6',
      'SHAS': '#22c55e'
    };
    return dept ? colors[dept.toUpperCase()] || '#6b7280' : '#6b7280';
  }

  goToStep(step: 'import' | 'generate' | 'summary' | 'timetable' | 'coursegrid') {
    this.currentStep = step;
  }

  getTermYearLabel(termYearCode: string): string {
    if (!termYearCode) return 'Unknown';
    if (termYearCode.includes('Semester') || termYearCode.includes('Summer')) return termYearCode;
    
    if (/^\d{7}$/.test(termYearCode)) {
      const termMap: any = { '1': '1st Semester', '2': '2nd Semester', '3': 'Summer' };
      const termCode = termYearCode.slice(-1);
      const year1 = termYearCode.slice(0, 4);
      const year2 = '20' + termYearCode.slice(4, 6);
      return `${termMap[termCode] || 'Unknown'} SY ${year1}-${year2}`;
    }
    
    return 'Unknown';
  }

  getDateRange(days: ExamDay[]): string {
    if (!days || days.length === 0) return '-';

    const sorted = [...days].sort((a, b) => new Date(a.date!).getTime() - new Date(b.date!).getTime());

    return sorted.map(d => {
      const dt = new Date(d.date!);
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      const dd = String(dt.getDate()).padStart(2, '0');
      const yy = String(dt.getFullYear()).slice(-2);
      const weekday = dt.toLocaleDateString('en-US', { weekday: 'long' });
      return `${mm}/${dd}/${yy} (${weekday})`;
    }).join(', ');
  }

  hasEmptyDates(): boolean {
    return this.examDates.some(d => !d);
  }

  hasExamsForYear(course: string, year: number, day: string): boolean {
    if (!this.courseGridData.grid || !this.courseGridData.grid[day] || !this.courseGridData.grid[day][course]) {
      return false;
    }
    
    return Object.values(this.courseGridData.grid[day][course])
      .some((exams: any) => exams.some((exam: any) => exam.yearLevel === year));
  }

  openDatePickerDialog() {
    const dialogRef = this.dialog.open(DatePickerComponent, {
      width: '800px',
      maxHeight: '90vh',
      disableClose: false
    });

    dialogRef.afterClosed().subscribe(() => {
      this.loadSavedExamGroups();
      this.cdr.detectChanges();
    });
  }

  loadSwal() {
    Swal.fire({
      title: 'Loading',
      text: 'Fetching exam data...',
      allowOutsideClick: false,
      allowEscapeKey: false,
      onOpen: () => Swal.showLoading()
    });
  }

  showToast(title: string, description: string, variant: string = 'success') {
    this.toast = { title, description, variant };
    setTimeout(() => this.toast = null, 3000);
  }
}