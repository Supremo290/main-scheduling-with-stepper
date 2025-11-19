import { ChangeDetectorRef, Component, OnInit, OnDestroy } from '@angular/core';
import { ApiService } from '../api.service';
import { GlobalService } from '../global.service';
import { map } from 'rxjs/operators';
import Swal from 'sweetalert2';
import { SubjectGroup, DepartmentGroup, ProgramSchedule } from '../subject-code';
import { MatDialog } from '@angular/material';
import { DatePickerComponent } from '../date-picker/date-picker.component';
import { SharedDataService } from '../shared-data.service';

@Component({
  selector: 'app-student-mapping',
  templateUrl: './student-mapping.component.html',
  styleUrls: ['./student-mapping.component.scss']
})
export class StudentMappingComponent implements OnInit, OnDestroy {

  rawCodes: any[] = [];
  codes: any[] = [];
  subjectId: string;
  programsAll: ProgramSchedule[] = [];
  programs: ProgramSchedule[] = [];

  currentExamGroupName: string = '';
  activeTerm: string;
  startDate: Date | null = null;
  selectedDates: string[] = [];
  daysWithTimeSlots: { [day: string]: string[] } = {};

  showTable = false;

  timeSlots: string[] = [
    '7:30 AM - 9:00 AM', '9:00 AM - 10:30 AM', '10:30 AM - 12:00 PM',
    '12:00 PM - 1:30 PM', '1:30 PM - 3:00 PM', '3:00 PM - 4:30 PM',
    '4:30 PM - 6:00 PM', '6:00 PM - 7:30 PM'
  ];

  displayedColumns: string[] = ['program', ...this.timeSlots];
  termOptions = [
    { key: 1, value: '1st Term' },
    { key: 2, value: '2nd Term' },
    { key: 3, value: 'Summer' },
  ];

  combinedOptions: { label: string, value: string }[] = [];
  departments: DepartmentGroup[] = [];
  swal = Swal;
  prevSelection: { [fullSlot: string]: string } = {};
  selectedScheduleOutput: any[] = [];

  private previousDates: string[] = [];
  private dataLoaded: boolean = false;
  private previousExamGroupName: string = '';
  private isInitialLoad: boolean = true;
  private isComponentActive = true;

  constructor(
    public api: ApiService, 
    public global: GlobalService, 
    private dialog: MatDialog,  
    private sharedData: SharedDataService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.combineYearTerm();

    this.sharedData.activeTerm$.subscribe((term) => {
      if (term && term !== this.activeTerm) {
        console.log("🔔 Active term changed to:", term);
        this.activeTerm = term;
        this.dataLoaded = false;
        
        if (this.activeTerm) {
          this.fetchProgramData();
        }
      } else if (term) {
        this.activeTerm = term;
      }
    });

    const savedTerm = this.sharedData.getActiveTerm();
    if (savedTerm) {
      this.activeTerm = savedTerm;
      console.log("📖 Restored active term:", this.activeTerm);
      this.fetchProgramData();
    }

    this.sharedData.examDates$.subscribe((dates) => {
      console.log("🔔 Received exam dates update:", dates);
      
      if (!dates || dates.length === 0) {
        console.log("🗑️ All dates cleared. Resetting student mapping...");
        this.selectedDates = [];
        this.daysWithTimeSlots = {};
        this.previousDates = [];
        this.showTable = false;
        this.isInitialLoad = true;
        
        for (const prog of this.programsAll) {
          prog.schedule = {};
        }
        
        this.updateSelectedScheduleOutput();
        this.updateRemainingSubjectsForAll();
        this.cdr.detectChanges();
        return;
      }

      const AM_SLOTS = ['7:30 AM - 9:00 AM', '9:00 AM - 10:30 AM', '10:30 AM - 12:00 PM'];
      const PM_SLOTS = ['12:00 PM - 1:30 PM', '1:30 PM - 3:00 PM', '3:00 PM - 4:30 PM', '4:30 PM - 6:00 PM', '6:00 PM - 7:30 PM'];

      const newDates = dates.map(d => new Date(d.date).toLocaleDateString('en-CA'));
      
      // ✅ Check if this is initial load or date change
      if (this.isInitialLoad || this.previousDates.length === 0) {
        console.log("📅 Initial load - setting dates:", newDates);
        this.selectedDates = newDates;
        this.previousDates = [...newDates];
        this.daysWithTimeSlots = {};
        
        dates.forEach((d: any) => {
          const key = new Date(d.date).toLocaleDateString('en-CA');
          if (d.am && d.pm) this.daysWithTimeSlots[key] = [...AM_SLOTS, ...PM_SLOTS];
          else if (d.am) this.daysWithTimeSlots[key] = [...AM_SLOTS];
          else if (d.pm) this.daysWithTimeSlots[key] = [...PM_SLOTS];
        });

        this.isInitialLoad = false;
        
        // Load saved schedule after setting dates
        setTimeout(() => {
          this.loadSavedScheduleForCurrentGroup();
        }, 100);
        
      } else {
        // ✅ Dates changed - migrate data
        const datesChanged = this.haveDatesChanged(newDates);
        
        if (datesChanged) {
          console.log("🔄 Dates changed! Need to migrate from", this.previousDates, "to", newDates);
          
          // ✅ First load the saved data with old dates
          this.loadSavedScheduleWithOldDates(this.previousDates);
          
          // ✅ Then migrate to new dates
          setTimeout(() => {
            this.migrateScheduleData(this.previousDates, newDates, dates);
          }, 100);
        }
      }

      this.updateRemainingSubjectsForAll();
      this.cdr.detectChanges();
    });

    this.sharedData.selectedExamGroup$.subscribe((group) => {
      if (group) {
        const newGroupName = group.name;
        
        if (newGroupName !== this.previousExamGroupName && this.previousExamGroupName !== '') {
          console.log(`🔄 Switched from "${this.previousExamGroupName}" to "${newGroupName}"`);
          
          for (const prog of this.programsAll) {
            prog.schedule = {};
          }
          
          this.isInitialLoad = true;
          this.updateSelectedScheduleOutput();
          this.updateRemainingSubjectsForAll();
        }
        
        this.currentExamGroupName = newGroupName;
        this.previousExamGroupName = newGroupName;
        console.log("📋 Selected exam group:", this.currentExamGroupName);
      }
    });

    const storedDates = this.sharedData.getExamDates();
    if (storedDates && storedDates.length && this.selectedDates.length === 0) {
      this.selectedDates = storedDates.map((d: any) => new Date(d.date).toLocaleDateString('en-CA'));
      this.previousDates = [...this.selectedDates];
      
      const AM_SLOTS = ['7:30 AM - 9:00 AM', '9:00 AM - 10:30 AM', '10:30 AM - 12:00 PM'];
      const PM_SLOTS = ['12:00 PM - 1:30 PM', '1:30 PM - 3:00 PM', '3:00 PM - 4:30 PM', '4:30 PM - 6:00 PM', '6:00 PM - 7:30 PM'];
      
      storedDates.forEach((d: any) => {
        const key = new Date(d.date).toLocaleDateString('en-CA');
        if (d.am && d.pm) this.daysWithTimeSlots[key] = [...AM_SLOTS, ...PM_SLOTS];
        else if (d.am) this.daysWithTimeSlots[key] = [...AM_SLOTS];
        else if (d.pm) this.daysWithTimeSlots[key] = [...PM_SLOTS];
      });
    }

    const currentGroup = this.sharedData.getSelectedExamGroup();
    if (currentGroup) {
      this.currentExamGroupName = currentGroup.name;
      this.previousExamGroupName = currentGroup.name;
    }
  }


  ngOnDestroy() {
    this.isComponentActive = false;
  }

  private fetchProgramData() {
    if (!this.activeTerm) {
      console.log("⚠️ Cannot fetch data - no active term");
      return;
    }

    if (this.dataLoaded) {
      console.log("ℹ️ Data already loaded for term:", this.activeTerm);
      return;
    }

    console.log("📡 Fetching program data for term:", this.activeTerm);
    this.loadSwal();
    this.getCodeSummaryReport(this.activeTerm);
  }

  // ✅ Load saved schedule with OLD dates (before migration)
  private loadSavedScheduleWithOldDates(oldDates: string[]) {
    if (!this.currentExamGroupName || !this.activeTerm) {
      console.log("⚠️ Cannot load schedule - missing group name or term");
      return;
    }

    if (this.programsAll.length === 0) {
      console.log("⚠️ Cannot load schedule - programs not loaded yet");
      return;
    }

    const savedSchedule = this.sharedData.getStudentMappingForGroup(
      this.currentExamGroupName,
      this.activeTerm
    );

    if (savedSchedule) {
      console.log("📖 Loading saved schedule with OLD dates for migration:", oldDates);
      
      // Clear existing schedules first
      for (const prog of this.programsAll) {
        prog.schedule = {};
      }

      // Restore schedules from saved data (with old dates)
      for (const dayData of savedSchedule) {
        const date = dayData.date;
        
        for (const programData of dayData.programs) {
          const prog = this.programsAll.find(
            p => p.program === programData.program && p.year === programData.year
          );

          if (prog) {
            for (const subjData of programData.subjects) {
              const fullSlot = `${date}_${subjData.sched}`;
              prog.schedule[fullSlot] = subjData.subjectId;
              console.log(`Loaded: ${fullSlot} = ${subjData.subjectId}`);
            }
          }
        }
      }

      console.log("✅ Old schedule loaded, ready for migration");
    } else {
      console.log("ℹ️ No saved schedule found");
    }
  }

  private loadSavedScheduleForCurrentGroup() {
    if (!this.currentExamGroupName || !this.activeTerm) {
      console.log("⚠️ Cannot load schedule - missing group name or term");
      return;
    }

    if (this.programsAll.length === 0) {
      console.log("⚠️ Cannot load schedule - programs not loaded yet");
      return;
    }

    const savedSchedule = this.sharedData.getStudentMappingForGroup(
      this.currentExamGroupName,
      this.activeTerm
    );

    if (savedSchedule) {
      console.log("📖 Loading saved schedule for", this.currentExamGroupName);
      
      for (const prog of this.programsAll) {
        prog.schedule = {};
      }

      for (const dayData of savedSchedule) {
        const date = dayData.date;
        
        if (this.selectedDates.includes(date)) {
          for (const programData of dayData.programs) {
            const prog = this.programsAll.find(
              p => p.program === programData.program && p.year === programData.year
            );

            if (prog) {
              for (const subjData of programData.subjects) {
                const fullSlot = `${date}_${subjData.sched}`;
                
                const availableSlots = this.daysWithTimeSlots[date] || [];
                if (availableSlots.includes(subjData.sched)) {
                  prog.schedule[fullSlot] = subjData.subjectId;
                }
              }
            }
          }
        }
      }

      this.updateRemainingSubjectsForAll();
      if (this.isComponentActive) {
  try {
    this.cdr.detectChanges();
  } catch (e) {
    console.warn("Change detection skipped:", e);
  }
}
      console.log("✅ Schedule restored successfully!");
    } else {
      console.log("ℹ️ No saved schedule found for this group");
    }
  }

  private haveDatesChanged(newDates: string[]): boolean {
    if (this.previousDates.length !== newDates.length) return true;
    
    for (let i = 0; i < newDates.length; i++) {
      if (this.previousDates[i] !== newDates[i]) return true;
    }
    
    return false;
  }

  private migrateScheduleData(oldDates: string[], newDates: string[], dateObjects: any[]) {
    console.log("📋 Starting migration from:", oldDates, "to:", newDates);

    const AM_SLOTS = ['7:30 AM - 9:00 AM', '9:00 AM - 10:30 AM', '10:30 AM - 12:00 PM'];
    const PM_SLOTS = ['12:00 PM - 1:30 PM', '1:30 PM - 3:00 PM', '3:00 PM - 4:30 PM', '4:30 PM - 6:00 PM', '6:00 PM - 7:30 PM'];

    // ✅ Build new time slots structure
    const newDaysWithTimeSlots: { [day: string]: string[] } = {};
    dateObjects.forEach((d: any) => {
      const key = new Date(d.date).toLocaleDateString('en-CA');
      if (d.am && d.pm) newDaysWithTimeSlots[key] = [...AM_SLOTS, ...PM_SLOTS];
      else if (d.am) newDaysWithTimeSlots[key] = [...AM_SLOTS];
      else if (d.pm) newDaysWithTimeSlots[key] = [...PM_SLOTS];
    });

    // ✅ Migrate each program's schedule
    for (const prog of this.programsAll) {
      if (!prog.schedule) continue;

      const newSchedule: { [key: string]: string } = {};

      // ✅ Go through old dates and map to new dates by index
      oldDates.forEach((oldDate, index) => {
        const newDate = newDates[index];
        
        if (!newDate) return; // No corresponding new date
        
        const oldDatePrefix = oldDate + '_';
        const newDatePrefix = newDate + '_';
        
        // Find all schedule entries for this old date
        const scheduleKeysForOldDate = Object.keys(prog.schedule)
          .filter(key => key.startsWith(oldDatePrefix));

        const newDateSlots = newDaysWithTimeSlots[newDate] || [];
        
        // Migrate each schedule entry
        scheduleKeysForOldDate.forEach(oldKey => {
          const timeslot = oldKey.replace(oldDatePrefix, '');
          const newKey = newDatePrefix + timeslot;
          
          // Only migrate if the new date supports this timeslot
          if (newDateSlots.includes(timeslot)) {
            newSchedule[newKey] = prog.schedule[oldKey];
            console.log(`✅ Migrated: ${oldKey} → ${newKey} (${prog.schedule[oldKey]})`);
          } else {
            console.log(`⚠️ Cannot migrate ${oldKey}: timeslot not available in new date`);
          }
        });
      });

      // ✅ Replace old schedule with migrated schedule
      prog.schedule = newSchedule;
    }

    // ✅ Update component state
    this.daysWithTimeSlots = newDaysWithTimeSlots;
    this.selectedDates = newDates;
    this.previousDates = [...newDates];
    
    this.updateSelectedScheduleOutput();
    this.updateRemainingSubjectsForAll();
    
    // ✅ Save migrated data with NEW dates
    this.autoSaveSchedule();

    console.log("✅ Migration complete and auto-saved with new dates");
    console.log("Final schedule:", this.programsAll.map(p => ({ 
      program: p.program, 
      year: p.year, 
      schedule: p.schedule 
    })));
  }

  private autoSaveSchedule() {
    if (!this.currentExamGroupName || !this.activeTerm) {
      console.log("⚠️ Cannot auto-save - missing group name or term");
      return;
    }

    if (this.programsAll.length === 0) {
      console.log("⚠️ Cannot auto-save - no program data loaded");
      return;
    }

    let hasScheduleData = false;
    for (const prog of this.programsAll) {
      if (prog.schedule && Object.keys(prog.schedule).length > 0) {
        hasScheduleData = true;
        break;
      }
    }

    if (!hasScheduleData) {
      console.log("ℹ️ No schedule data to auto-save");
      return;
    }

    console.log("💾 Auto-saving schedule data with dates:", this.selectedDates);
    this.updateSelectedScheduleOutput();
    
    console.log("Saving output:", this.selectedScheduleOutput);
    
    this.sharedData.setStudentMappingForGroup(
      this.currentExamGroupName,
      this.activeTerm,
      this.selectedScheduleOutput
    );
    
    console.log("✅ Schedule auto-saved successfully");
  }

  combineYearTerm() {
    const currentYear = new Date().getFullYear();
    for (let y = currentYear - 2; y <= currentYear + 1; y++) {
      const nextYear = y + 1;
      for (const t of this.termOptions) {
        const label = `${t.value} ${y}-${nextYear}`;
        const value = `${y}${nextYear.toString().slice(-2)}${t.key}`;
        this.combinedOptions.push({ label, value });
      }
    }
  }

  // selectTermYear() {
  //   if (!this.activeTerm) {
  //     this.global.swalAlertError("Please select an exam group with term from Step 1");
  //     return;
  //   }

  //   if (this.selectedDates.length === 0) {
  //     this.global.swalAlertError("Please select exam dates from Step 1");
  //     return;
  //   }

  //   if (!this.dataLoaded) {
  //     this.fetchProgramData();
  //   }
  // }

 getCodeSummaryReport(sy) {
  this.api.getCodeSummaryReport(sy)
    .map((response: any) => response.json())
    .subscribe(
      res => {
        this.rawCodes = res.data;
        Swal.close();

        this.codes = this.getUniqueSubjectIds(res.data);
        this.programsAll = this.getUniqueProgramsAll(res.data);
        this.programs = this.programsAll.filter(p => !(p.dept && p.dept.toUpperCase() === 'SAS'));

        for (const p of this.programsAll) {
          if (!p.schedule) p.schedule = {};
          p.remainingSubjects = this.getRemainingSubjects(p);
        }

        this.dataLoaded = true;

        // ✅ ADD THIS LINE - Save room data to SharedDataService
        this.sharedData.getRoomSummary(res.data);
        console.log("✅ Room data saved to SharedDataService:", res.data.length, "items");

        this.loadSavedScheduleForCurrentGroup();

        this.updateSelectedScheduleOutput();
        this.updateRemainingSubjectsForAll();
        console.log("✅ Programs Loaded:", this.programsAll);
      },
      err => {
        Swal.close();
        this.global.swalAlertError(err);
      }
    );
}

  getUniqueSubjectIds(data: any[]): SubjectGroup[] {
    const groupedID: SubjectGroup[] = [];
    for (const item of data) {
      const existing = groupedID.find(s => s.subjectId === item.subjectId);
      if (existing) {
        existing.codes.push({
          codeNo: item.codeNo,
          course: item.course,
          year: item.yearLevel,
          dept: item.dept
        });
      } else {
        groupedID.push({
          subjectId: item.subjectId,
          subjectTitle: item.subjectTitle,
          units: Number(item.lecUnits) || 0,
          codes: [{
            codeNo: item.codeNo,
            course: item.course,
            year: item.yearLevel,
            dept: item.dept
          }]
        } as any);
      }
    }
    return groupedID;
  }

  getUniqueProgramsAll(data: any[]): ProgramSchedule[] {
    const groupedProg: ProgramSchedule[] = [];
    for (const item of data) {
      const existingProgram = groupedProg.find(p => p.program === item.course && p.year === item.yearLevel);
      const subjectData = {
        subjectId: item.subjectId,
        subjectTitle: item.subjectTitle,
        codeNo: item.codeNo,
        units: Number(item.lecUnits) || 0
      };
      if (existingProgram) {
        const exists = existingProgram.subjects.find(s => s.subjectId === subjectData.subjectId);
        if (!exists) existingProgram.subjects.push(subjectData);
      } else {
        groupedProg.push({
          program: item.course,
          year: item.yearLevel,
          dept: item.dept,
          subjects: [subjectData],
          schedule: {},
          remainingSubjects: 0
        } as ProgramSchedule);
      }
    }
    groupedProg.sort((a, b) => a.program.localeCompare(b.program) || Number(a.year) - Number(b.year));
    return groupedProg;
  }

  capturePrev(prog: ProgramSchedule, fullSlot: string) {
    const prev = (prog.schedule && prog.schedule[fullSlot]) ? prog.schedule[fullSlot] : '';
    this.prevSelection[fullSlot] = prev;
  }



getCodeCount(prog: ProgramSchedule, subjectId: string): number {
  if (!subjectId || !prog || !prog.subjects) {
    return 0;
  }

  // Find the subject in the program's subject list
  const subject = prog.subjects.find(s => s.subjectId === subjectId);
  
  if (!subject) {
    return 0;
  }

  // Count codes from the codes array in SubjectGroup
  // The subject might have multiple codes (sections)
  const subjectGroup = this.codes.find(c => c.subjectId === subjectId);
  
  if (subjectGroup && subjectGroup.codes) {
    return subjectGroup.codes.length;
  }

  // Default: assume 1 code if subject exists but no codes array found
  return 1;
}

  getAvailableSubjects(prog: ProgramSchedule, fullSlot: string) {
    const selectedSubjectIds = new Set<string>();
    for (const pAll of this.programsAll) {
      const vals = Object.values(pAll.schedule || {});
      for (const v of vals) {
        if (v) selectedSubjectIds.add(v);
      }
    }
    const currentSelected = prog.schedule && prog.schedule[fullSlot] ? prog.schedule[fullSlot] : '';
    return prog.subjects.filter(subj => !selectedSubjectIds.has(subj.subjectId) || subj.subjectId === currentSelected);
  }

  onSubjectSelect(prog: ProgramSchedule, slot: string, day: string) {
    const fullSlot = `${day}_${slot}`;
    const selectedId = prog.schedule && prog.schedule[fullSlot] ? prog.schedule[fullSlot] : '';

    if (!selectedId) {
      const previousSubjectId = this.prevSelection[fullSlot] || '';

      if (previousSubjectId) {
        const subjectData = prog.subjects.find(s => s.subjectId === previousSubjectId);
        const units = subjectData && subjectData.units ? Number(subjectData.units) : 3;
        const slotsForDay = this.daysWithTimeSlots[day] || [];

        for (const p of this.programsAll) {
          if (p.schedule) {
            Object.keys(p.schedule)
              .filter(k => p.schedule[k] === previousSubjectId)
              .forEach(k => {
                if (units === 6) {
                  const [kDay, kSlot] = k.split('_');
                  const idx = slotsForDay.indexOf(kSlot);
                  if (idx !== -1) {
                    const nextSlot = slotsForDay[idx + 1];
                    const prevSlot = slotsForDay[idx - 1];
                    const nextKey = nextSlot ? `${day}_${nextSlot}` : '';
                    const prevKey = prevSlot ? `${day}_${prevSlot}` : '';

                    if (nextKey && p.schedule[nextKey] === previousSubjectId) {
                      p.schedule[nextKey] = '';
                    }
                    if (prevKey && p.schedule[prevKey] === previousSubjectId) {
                      p.schedule[prevKey] = '';
                    }
                  }
                }
                p.schedule[k] = '';
              });
          }
        }
      }

      delete this.prevSelection[fullSlot];
      this.programs = this.programsAll.filter(p => !(p.dept && p.dept.toUpperCase() === 'SAS'));
      this.updateRemainingSubjectsForAll();
      this.updateSelectedScheduleOutput();
      return;
    }

    for (const p of this.programsAll) {
      const vals = Object.values(p.schedule || {});
      if (vals.includes(selectedId)) {
        if (!(p.program === prog.program && p.year === prog.year && p.schedule[fullSlot] === selectedId)) {
          this.global.swalAlertError("This subject is already assigned in another slot.");
          prog.schedule[fullSlot] = '';
          return;
        }
      }
    }

    const subjectData = prog.subjects.find(s => s.subjectId === selectedId);
    const units = subjectData && subjectData.units ? Number(subjectData.units) : 3;

    for (const p of this.programsAll) {
      if (p.subjects.find(s => s.subjectId === selectedId)) {
        if (!p.schedule) p.schedule = {};
        const slotsForDay = this.daysWithTimeSlots[day] || [];
        const currentIndex = slotsForDay.indexOf(slot);
        if (currentIndex === -1) continue;
        p.schedule[fullSlot] = selectedId;

        if (units === 6 && currentIndex + 1 < slotsForDay.length) {
          const nextSlot = slotsForDay[currentIndex + 1];
          const nextFullSlot = `${day}_${nextSlot}`;
          p.schedule[nextFullSlot] = selectedId;
        }
      }
    }

    this.programs = this.programsAll.filter(p => !(p.dept && p.dept.toUpperCase() === 'SAS'));
    this.updateRemainingSubjectsForAll();
    this.updateSelectedScheduleOutput();
    this.prevSelection[fullSlot] = selectedId;
  }

  goNext() {
    // this.selectTermYear();
    
    if (this.programs.length > 0) {
      this.showTable = true;
    }
  }

  updateRemainingSubjectsForAll() {
    for (const p of this.programs) {
      p.remainingSubjects = this.getRemainingSubjectsConsideringAllDays(p);
    }
  }

  getRemainingSubjectsConsideringAllDays(prog: ProgramSchedule): number {
    const total = (prog.subjects || []).length;
    const assigned = new Set<string>();
    const keys = Object.keys(prog.schedule || {});
    for (const key of keys) {
      const val = prog.schedule[key];
      if (val) assigned.add(val);
    }
    return total - assigned.size;
  }

  getRemainingSubjects(prog: ProgramSchedule): number {
    const total = (prog.subjects || []).length;
    const assignedCount = Object.values(prog.schedule || {}).filter((v: any) => v).length;
    return total - assignedCount;
  }

  updateSelectedScheduleOutput() {
    this.selectedScheduleOutput = [];
    for (const day of this.selectedDates) {
      const programsForDay: any[] = [];
      for (const p of this.programs) {
        const subjArr: any[] = [];
        const keys = Object.keys(p.schedule || {});
        for (const key of keys) {
          if (key.startsWith(day + '_')) {
            const subjId = p.schedule[key];
            if (subjId) {
              const subj = p.subjects.find(s => s.subjectId === subjId);
              subjArr.push({
                subjectId: subj ? subj.subjectId : '',
                subjectTitle: subj ? subj.subjectTitle : '',
                codeNo: subj ? subj.codeNo : '',
                sched: key.replace(day + '_', '')
              });
            }
          }
        }
        programsForDay.push({ program: p.program, year: p.year, subjects: subjArr });
      }
      this.selectedScheduleOutput.push({ date: day, programs: programsForDay });
    }
  }

  saveSchedule() {
    if (!this.currentExamGroupName) {
      this.global.swalAlertError("No exam group selected. Please select an exam group first.");
      return;
    }

    if (!this.activeTerm) {
      this.global.swalAlertError("No term selected. Please select a term first.");
      return;
    }

    console.log("Saving schedule for:", this.currentExamGroupName, this.activeTerm);
    console.log("Schedule output:", this.selectedScheduleOutput);

    this.sharedData.setStudentMappingForGroup(
      this.currentExamGroupName,
      this.activeTerm,
      this.selectedScheduleOutput
    );

    this.sharedData.setStudentMapping(this.selectedScheduleOutput);

    this.global.swalSuccess(`Schedule saved successfully for ${this.currentExamGroupName}!`);
  }

  removeDate(dateToRemove: string) {
    this.swal.fire({
      title: 'Remove Date?',
      text: `Are you sure you want to delete ${new Date(dateToRemove).toDateString()} and all its schedules?`,
      type: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Yes, remove it',
      cancelButtonText: 'Cancel'
    })
    .then((result) => {
      if (!result.value) return;

      this.selectedDates = this.selectedDates.filter(d => d !== dateToRemove);
      this.previousDates = [...this.selectedDates];
      delete this.daysWithTimeSlots[dateToRemove];

      for (const p of this.programsAll) {
        if (p.schedule) {
          Object.keys(p.schedule)
            .filter(key => key.startsWith(dateToRemove + '_'))
            .forEach(key => delete p.schedule[key]);
        }
      }

      this.updateSelectedScheduleOutput();
      this.updateRemainingSubjectsForAll();

      if (this.selectedDates.length === 0) this.showTable = false;

      this.swal.fire('Deleted!', 'The selected exam date and its schedules were removed.', 'success');
    });
  }

  loadSwal() {
    this.swal.fire({
      title: 'Loading',
      text: 'Fetching program data...',
      type: 'info',
      allowOutsideClick: false,
      allowEscapeKey: false,
      onOpen: function () {
        Swal.showLoading();
      }
    });
  }

  getTermYearLabel(termYearCode: string): string {
    if (!termYearCode) return '';
    
    const termMap: any = { '1': '1st Term', '2': '2nd Term', '3': 'Summer' };
    const termCode = termYearCode.slice(-1);
    const yearPart = termYearCode.slice(0, -1);
    const year1 = yearPart.slice(0, 4);
    const year2 = '20' + yearPart.slice(-2);
    
    return `${termMap[termCode] || 'Unknown'} ${year1}-${year2}`;
  }



autoAssignSchedule() {
  if (!this.activeTerm || this.selectedDates.length === 0) {
    this.global.swalAlertError("Please select term and exam dates first.");
    return;
  }

  if (!this.programsAll || this.programsAll.length === 0) {
    this.global.swalAlertError("Program data not loaded.");
    return;
  }

  // Check minimum days based on term type
  const minDays = this.isSummerTerm() ? 1 : 3;

  if (this.selectedDates.length < minDays) {
    const termType = this.isSummerTerm() ? 'Summer' : 'Regular';
    this.global.swalAlertError(`${termType} exams require at least ${minDays} day(s).`);
    return;
  }

  this.swal.fire({
    title: 'Auto-Assign Schedule?',
    html: `<p>This will assign subjects across <strong>${this.selectedDates.length} day(s)</strong> ${this.isSummerTerm() ? '(Summer Term)' : ''}:</p>
           <ul style="text-align: left; margin: 10px 40px; font-size: 13px;">
             <li>✓ 1.5-hour breaks between subjects</li>
             <li>✓ 6-unit subjects = 3 hours (2 slots)</li>
             <li>✓ ${this.isSummerTerm() ? '4-6' : '3-4'} subjects per day per program</li>
             <li>✓ Same subject ID = same time</li>
             <li>✓ Gen-Ed NOT at 7:30 AM</li>
             <li>✓ Even distribution across ${this.selectedDates.length} day(s)</li>
             <li>✓ No back-to-back major exams</li>
           </ul>
           <p><strong>Existing assignments will be cleared.</strong></p>`,
    type: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Yes, Auto-Assign',
    cancelButtonText: 'Cancel'
  }).then((result) => {
    if (result.value) {
      this.performCompleteAutoAssignment();
    }
  });
}

// Helper method to check if summer term
private isSummerTerm(): boolean {
  return this.activeTerm && this.activeTerm.endsWith('3');
}

private performCompleteAutoAssignment() {
  console.log("🚀 Starting complete auto-assignment with ALL constraints...");
  
  this.swal.fire({
    title: 'Processing',
    text: 'Assigning subjects with all rules enforced...',
    type: 'info',
    allowOutsideClick: false,
    allowEscapeKey: false,
    onOpen: () => {
      Swal.showLoading();
    }
  });

  setTimeout(() => {
    try {
      // Clear all schedules
      for (const prog of this.programsAll) {
        prog.schedule = {};
      }

      console.log("📊 Starting:");
      console.log("   Programs:", this.programsAll.length);
      console.log("   Days:", this.selectedDates.length);

      // Step 1: Categorize subjects
      const subjectTypes = this.categorizeSubjects();
      console.log("✅ Categorized subjects");
      
      // Step 2: Group by shared ID
      const subjectGroups = this.groupSubjectsBySharedId();
      console.log("✅ Grouped", subjectGroups.size, "subjects");
      
      // Step 3: Prioritize
      const sortedSubjects = this.prioritizeSubjects(subjectGroups, subjectTypes);
      console.log("✅ Prioritized subjects");
      
      // Step 4: Calculate targets
      const targets = this.calculateTargets();
      console.log("✅ Calculated targets");
      
      // Step 5: Assign with ALL constraints
      const result = this.assignWithAllConstraints(
        sortedSubjects,
        subjectTypes,
        targets
      );
      
      Swal.close();
      
      setTimeout(() => {
        this.updateSelectedScheduleOutput();
        this.updateRemainingSubjectsForAll();
        this.autoSaveSchedule();
        
        if (result.success) {
          let dayMsg = `Day 1: ${result.day1}`;
          if (result.day2 > 0) dayMsg += `, Day 2: ${result.day2}`;
          if (result.day3 > 0) dayMsg += `, Day 3: ${result.day3}`;
          
          this.global.swalSuccess(
            `✅ All ${result.total} subjects assigned!\n${dayMsg}`
          );
        } else {
          let dayMsg = `Day 1: ${result.day1}`;
          if (result.day2 > 0) dayMsg += `, Day 2: ${result.day2}`;
          if (result.day3 > 0) dayMsg += `, Day 3: ${result.day3}`;
          
          this.swal.fire({
            title: 'Partial Assignment',
            html: `<p><strong>${result.assigned}</strong> / <strong>${result.total}</strong> subjects assigned.</p>
                   <p>${dayMsg}</p>
                   <div style="max-height: 200px; overflow-y: auto; text-align: left; margin: 10px;">
                     <strong>Unassigned:</strong><br>
                     ${result.unassigned.join('<br>')}
                   </div>
                   <p><strong>Try:</strong></p>
                   <ul style="text-align: left; margin-left: 30px;">
                     <li>Add more exam dates (${this.selectedDates.length + 1}-${this.selectedDates.length + 2} days)</li>
                     <li>Enable more time slots per day</li>
                   </ul>`,
            type: 'warning',
            confirmButtonText: 'OK',
            width: '600px'
          });
        }
      }, 100);
      
    } catch (error) {
      Swal.close();
      console.error("❌ Error:", error);
      setTimeout(() => {
        this.global.swalAlertError(`Error: ${error.message}`);
      }, 100);
    }
  }, 300);
}

private categorizeSubjects(): Map<string, 'genEd' | 'major'> {
  const types = new Map<string, 'genEd' | 'major'>();
  
  for (const subj of this.codes) {
    const isGenEd = subj.codes && subj.codes.length >= 15;
    types.set(subj.subjectId, isGenEd ? 'genEd' : 'major');
  }
  
  return types;
}

private groupSubjectsBySharedId(): Map<string, ProgramSchedule[]> {
  const groups = new Map<string, ProgramSchedule[]>();
  
  for (const prog of this.programsAll) {
    for (const subj of prog.subjects) {
      if (!groups.has(subj.subjectId)) {
        groups.set(subj.subjectId, []);
      }
      groups.get(subj.subjectId)!.push(prog);
    }
  }
  
  return groups;
}

private prioritizeSubjects(
  groups: Map<string, ProgramSchedule[]>,
  types: Map<string, 'genEd' | 'major'>
): Array<any> {
  
  const subjects: Array<any> = [];
  
  for (const [subjectId, programs] of groups.entries()) {
    const data = programs[0].subjects.find(s => s.subjectId === subjectId);
    const units = data ? data.units : 3;
    const type = types.get(subjectId) || 'major';
    
    subjects.push({
      subjectId,
      programs,
      units,
      type,
      count: programs.length
    });
  }
  
  // Sort: 6-unit first, shared next, gen-ed before major
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
  const numDays = this.selectedDates.length;
  const maxPerDay = this.isSummerTerm() ? 6 : 4;
  
  for (const prog of this.programsAll) {
    const key = `${prog.program}_${prog.year}`;
    const total = prog.subjects.length;
    
    const perDay = Math.ceil(total / numDays);
    const targetArr: number[] = [];
    
    for (let i = 0; i < numDays; i++) {
      targetArr.push(Math.min(perDay, maxPerDay));
    }
    
    targets.set(key, targetArr);
  }
  
  return targets;
}

private assignWithAllConstraints(
  sortedSubjects: Array<any>,
  types: Map<string, 'genEd' | 'major'>,
  targets: Map<string, number[]>
): any {
  
  const assigned = new Set<string>();
  const unassigned: string[] = [];
  const slotMap = new Map<string, {day: string, slot: string}>();
  const dayCount = new Map<string, Map<string, number>>();
  const dayMajors = new Map<string, Map<string, Set<string>>>();
  
  // Initialize
  for (const prog of this.programsAll) {
    const key = `${prog.program}_${prog.year}`;
    dayCount.set(key, new Map());
    dayMajors.set(key, new Map());
    
    for (const day of this.selectedDates) {
      dayCount.get(key)!.set(day, 0);
      dayMajors.get(key)!.set(day, new Set());
    }
  }
  
  // Assign each subject
  for (const subject of sortedSubjects) {
    if (assigned.has(subject.subjectId)) continue;
    
    // Check if already assigned
    if (slotMap.has(subject.subjectId)) {
      const existing = slotMap.get(subject.subjectId)!;
      this.assignSubject(subject, existing.day, existing.slot, dayCount, dayMajors, types);
      assigned.add(subject.subjectId);
      continue;
    }
    
    // Find best slot
    const slot = this.findBestSlotStrict(
      subject,
      types,
      dayCount,
      dayMajors,
      targets
    );
    
    if (slot) {
      this.assignSubject(subject, slot.day, slot.slot, dayCount, dayMajors, types);
      slotMap.set(subject.subjectId, slot);
      assigned.add(subject.subjectId);
      console.log(`✅ ${subject.subjectId} (${subject.units}u, ${subject.type}) → ${slot.day} ${slot.slot}`);
    } else {
      unassigned.push(`${subject.subjectId} (${subject.units}u, ${subject.type}, ${subject.count} progs)`);
      console.warn(`⚠️ Failed: ${subject.subjectId}`);
    }
  }
  
  const day1 = this.countDayAssignments(dayCount, 0);
  const day2 = this.selectedDates.length > 1 ? this.countDayAssignments(dayCount, 1) : 0;
  const day3 = this.selectedDates.length > 2 ? this.countDayAssignments(dayCount, 2) : 0;
  
  return {
    success: assigned.size === sortedSubjects.length,
    assigned: assigned.size,
    total: sortedSubjects.length,
    day1,
    day2,
    day3,
    unassigned
  };
}

private findBestSlotStrict(
  subject: any,
  types: Map<string, 'genEd' | 'major'>,
  dayCount: Map<string, Map<string, number>>,
  dayMajors: Map<string, Map<string, Set<string>>>,
  targets: Map<string, number[]>
): {day: string, slot: string} | null {
  
  const dayScores = this.calculateDayPreference(subject.programs, dayCount, targets);
  
  for (const {day, dayIndex} of dayScores) {
    const slots = this.daysWithTimeSlots[day] || [];
    
    // Get slot order that distributes evenly (not always starting at 7:30 AM)
    const slotOrder = this.getDistributedSlotOrder(slots, day);
    
    for (const slotIndex of slotOrder) {
      const slot = slots[slotIndex];
      
      // RULE: Gen-Ed NOT at 7:30 AM
      if (subject.type === 'genEd' && slot === '7:30 AM - 9:00 AM') {
        continue;
      }
      
      if (this.checkAllConstraints(
        subject,
        day,
        slot,
        slots,
        dayCount,
        dayMajors,
        types
      )) {
        return { day, slot };
      }
    }
  }
  
  return null;
}

// Get slot order that distributes subjects across all time slots
private getDistributedSlotOrder(slots: string[], day: string): number[] {
  const order: number[] = [];
  
  // Count how many subjects already assigned to each slot
  const slotCounts: number[] = new Array(slots.length).fill(0);
  
  for (const prog of this.programsAll) {
    if (!prog.schedule) continue;
    
    for (let i = 0; i < slots.length; i++) {
      const fullSlot = `${day}_${slots[i]}`;
      if (prog.schedule[fullSlot]) {
        slotCounts[i]++;
      }
    }
  }
  
  // Create array of slot indices with their counts
  const slotInfo = slots.map((slot, index) => ({
    index,
    count: slotCounts[index],
    slot
  }));
  
  // Sort by count (ascending) - try least-used slots first
  slotInfo.sort((a, b) => {
    if (a.count !== b.count) {
      return a.count - b.count; // Least used first
    }
    return a.index - b.index; // Then by original order
  });
  
  // Return sorted indices
  return slotInfo.map(s => s.index);
}

private calculateDayPreference(
  programs: ProgramSchedule[],
  dayCount: Map<string, Map<string, number>>,
  targets: Map<string, number[]>
): Array<{day: string, dayIndex: number, score: number}> {
  
  const scores: Array<any> = [];
  
  for (let i = 0; i < this.selectedDates.length; i++) {
    const day = this.selectedDates[i];
    let score = 0;
    
    for (const prog of programs) {
      const key = `${prog.program}_${prog.year}`;
      const current = dayCount.get(key)!.get(day)!;
      const target = targets.get(key)![i];
      
      if (current < target) {
        score += (target - current) * 100;
      } else {
        score -= (current - target) * 50;
      }
    }
    
    scores.push({ day, dayIndex: i, score });
  }
  
  scores.sort((a, b) => b.score - a.score);
  
  return scores;
}

private checkAllConstraints(
  subject: any,
  day: string,
  slot: string,
  slots: string[],
  dayCount: Map<string, Map<string, number>>,
  dayMajors: Map<string, Map<string, Set<string>>>,
  types: Map<string, 'genEd' | 'major'>
): boolean {
  
  const slotIdx = slots.indexOf(slot);
  
  for (const prog of subject.programs) {
    const key = `${prog.program}_${prog.year}`;
    const full = `${day}_${slot}`;
    
    // 1. Slot must be free
    if (prog.schedule && prog.schedule[full]) {
      return false;
    }
    
    // 2. 6-unit needs 2 consecutive slots
    if (subject.units === 6) {
      if (slotIdx + 1 >= slots.length) {
        return false;
      }
      const nextSlot = slots[slotIdx + 1];
      const nextFull = `${day}_${nextSlot}`;
      if (prog.schedule && prog.schedule[nextFull]) {
        return false;
      }
    }
    
    // 3. Max subjects per day (dynamic based on term)
    const maxPerDay = this.isSummerTerm() ? 6 : 4;
    const count = dayCount.get(key)!.get(day)!;
    if (count >= maxPerDay) {
      return false;
    }
    
    // 4. RULE: 1.5hr break
    if (slotIdx > 0) {
      const prevSlot = slots[slotIdx - 1];
      if (prog.schedule && prog.schedule[`${day}_${prevSlot}`]) {
        return false;
      }
    }
    
    if (slotIdx + 1 < slots.length) {
      const nextSlot = slots[slotIdx + 1];
      if (prog.schedule && prog.schedule[`${day}_${nextSlot}`]) {
        return false;
      }
    }
    
    // 5. RULE: No back-to-back majors
    if (subject.type === 'major') {
      if (slotIdx > 0) {
        const prevSlot = slots[slotIdx - 1];
        const prevSubj = prog.schedule ? prog.schedule[`${day}_${prevSlot}`] : null;
        if (prevSubj && types.get(prevSubj) === 'major') {
          return false;
        }
      }
      
      if (slotIdx + 2 < slots.length) {
        const slot2Ahead = slots[slotIdx + 2];
        const subj2Ahead = prog.schedule ? prog.schedule[`${day}_${slot2Ahead}`] : null;
        if (subj2Ahead && types.get(subj2Ahead) === 'major') {
          return false;
        }
      }
    }
  }
  
  return true;
}

private assignSubject(
  subject: any,
  day: string,
  slot: string,
  dayCount: Map<string, Map<string, number>>,
  dayMajors: Map<string, Map<string, Set<string>>>,
  types: Map<string, 'genEd' | 'major'>
): void {
  
  for (const prog of subject.programs) {
    const full = `${day}_${slot}`;
    
    if (!prog.schedule) {
      prog.schedule = {};
    }
    
    prog.schedule[full] = subject.subjectId;
    
    if (subject.units === 6) {
      const nextSlot = this.getNextSlot(day, slot);
      if (nextSlot) {
        prog.schedule[`${day}_${nextSlot}`] = subject.subjectId;
      }
    }
    
    const key = `${prog.program}_${prog.year}`;
    const count = dayCount.get(key)!.get(day)!;
    dayCount.get(key)!.set(day, count + 1);
    
    if (subject.type === 'major') {
      dayMajors.get(key)!.get(day)!.add(subject.subjectId);
    }
  }
}

private getNextSlot(day: string, slot: string): string | null {
  const slots = this.daysWithTimeSlots[day] || [];
  const idx = slots.indexOf(slot);
  return (idx >= 0 && idx + 1 < slots.length) ? slots[idx + 1] : null;
}

private countDayAssignments(
  dayCount: Map<string, Map<string, number>>,
  dayIndex: number
): number {
  
  let total = 0;
  const day = this.selectedDates[dayIndex];
  
  for (const counts of dayCount.values()) {
    total += counts.get(day) || 0;
  }
  
  return total;
}

}


























