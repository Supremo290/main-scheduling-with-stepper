import { Component, Inject, OnInit, Optional } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { SharedDataService } from '../shared-data.service';

interface ExamDay {
  date: Date | null;
  am: boolean;
  pm: boolean;
}

interface ExamGroup {
  name: string;
  days: ExamDay[];
  termYear?: string;
}

@Component({
  selector: 'app-date-picker',
  templateUrl: './date-picker.component.html',
  styleUrls: ['./date-picker.component.scss']
})
export class DatePickerComponent implements OnInit {
  examDays: ExamDay[] = [];
  savedExamGroups: ExamGroup[] = [];
  selectedGroupName: string | null = null;
  newGroupName: string = '';
  
  selectedTermYear: string = '';
  termYearOptions: { label: string, value: string }[] = [];

  showEditor = true;
  editingGroup: ExamGroup | null = null;

  maxDays = 5;
  minDate!: Date;
  maxDate!: Date;

  constructor(
    private sharedData: SharedDataService,
    @Optional() public dialogRef?: MatDialogRef<DatePickerComponent>,
    @Optional() @Inject(MAT_DIALOG_DATA) public data?: any
  ) {}

  ngOnInit() {
  const currentYear = new Date().getFullYear();
  this.minDate = new Date(currentYear, 0, 1);
  this.maxDate = new Date(2035, 11, 31);

  this.generateTermYearOptions();
  this.loadStoredGroups();
  
  if (!this.data || this.data.mode !== 'edit') {
    this.sharedData.clearSelectedExamGroup();
    this.sharedData.clearExamDates();
    this.sharedData.clearActiveTerm();
    this.selectedGroupName = null;
  }
  
  if (this.data && this.data.mode === 'edit' && this.data.group) {
    this.editGroup(this.data.group);
  } else {
    this.resetExamDays();
  }
}

  generateTermYearOptions() {
    const currentYear = new Date().getFullYear();
    // ✅ FIXED: Changed to "Semester" but VALUE will be numeric code
    const terms = [
      { key: 1, value: '1st Semester' },
      { key: 2, value: '2nd Semester' },
      { key: 3, value: 'Summer' },
    ];

    for (let y = currentYear - 2; y <= currentYear + 1; y++) {
      const nextYear = y + 1;
      for (const t of terms) {
        // ✅ FIXED: Label shows "Semester SY" but value is numeric code for API
        const label = `${t.value} SY ${y}-${nextYear}`;
        const value = `${y}${nextYear.toString().slice(-2)}${t.key}`;
        this.termYearOptions.push({ label, value });
      }
    }
  }

  addDates() {
    this.showEditor = true;
    this.editingGroup = null;
    this.resetExamDays();
    this.newGroupName = '';
    this.selectedTermYear = '';
  }

  loadStoredGroups() {
    const stored = localStorage.getItem('examGroups');
    this.savedExamGroups = stored ? JSON.parse(stored) : [];
  }

  saveAllGroups() {
    localStorage.setItem('examGroups', JSON.stringify(this.savedExamGroups));
  }

  addDay() {
    if (this.examDays.length < this.maxDays) {
      this.examDays.push({ date: null, am: false, pm: false });
    }
  }

  removeDay(index: number) {
    this.examDays.splice(index, 1);
  }

  resetExamDays() {
    this.examDays = [{ date: null, am: false, pm: false }];
  }

  editGroup(group: ExamGroup) {
    this.editingGroup = group;
    this.showEditor = true;
    this.newGroupName = group.name;
    this.selectedTermYear = group.termYear || '';
    this.examDays = group.days.map(d => ({
      date: d.date ? new Date(d.date) : null,
      am: d.am,
      pm: d.pm
    }));
  }

  saveGroup() {
  const validDays = this.examDays.filter(d => d.date instanceof Date);

  if (!validDays.length) {
    alert('Please select at least one valid exam date.');
    return;
  }

  if (!this.newGroupName.trim()) {
    alert('Please enter a name for this exam schedule.');
    return;
  }

  if (!this.selectedTermYear) {
    alert('Please select a Term & School Year for this exam schedule.');
    return;
  }

  // ✅ IMPORTANT: Store numeric code (e.g., "2023241") for API
  const updatedGroup: ExamGroup = {
    name: this.newGroupName.trim(),
    days: validDays,
    termYear: this.selectedTermYear
  };

  console.log('💾 Saving group with termYear:', this.selectedTermYear);

  if (this.editingGroup) {
    // ✅ FIXED: Use findIndex with name comparison instead of indexOf with object reference
    const index = this.savedExamGroups.findIndex(g => g.name === this.editingGroup.name);
    console.log('🔍 Looking for group:', this.editingGroup.name);
    console.log('📍 Found at index:', index);
    
    if (index !== -1) {
      console.log('✅ Updating group at index:', index);
      this.savedExamGroups[index] = updatedGroup;
      
      const currentlySelected = this.sharedData.getSelectedExamGroup();
      if (currentlySelected && currentlySelected.name === this.editingGroup.name) {
        console.log(`✏️ Updating currently selected group "${updatedGroup.name}"`);
        
        this.sharedData.setExamDates(updatedGroup.days);
        this.sharedData.setSelectedExamGroup(updatedGroup);
        this.sharedData.setActiveTerm(updatedGroup.termYear!);
        
        console.log("✅ Updated exam dates, triggering migration in student-mapping");
      }
    } else {
      console.error('❌ ERROR: Could not find group to update!');
      console.error('❌ Available groups:', this.savedExamGroups.map(g => g.name));
    }
    alert('✏️ Exam group updated! Your schedule data has been preserved.');
  } else {
    const existingIndex = this.savedExamGroups.findIndex(
      g => g.name === updatedGroup.name
    );

    if (existingIndex !== -1) {
      if (confirm(`"${updatedGroup.name}" already exists. Replace it?`)) {
        this.savedExamGroups[existingIndex] = updatedGroup;
      } else {
        return;
      }
    } else {
      this.savedExamGroups.push(updatedGroup);
    }

    alert('✅ Exam group saved!');
  }

  this.saveAllGroups();
  this.loadStoredGroups();

  if (this.dialogRef) {
    this.dialogRef.close({ success: true, group: updatedGroup });
  }
}

  deleteGroup(groupName: string) {
    if (confirm(`Delete exam group "${groupName}"?`)) {
      const groupToDelete = this.savedExamGroups.find(g => g.name === groupName);
      
      const currentlySelected = this.sharedData.getSelectedExamGroup();
      const isSelectedGroup = currentlySelected && currentlySelected.name === groupName;

      this.savedExamGroups = this.savedExamGroups.filter(g => g.name !== groupName);
      this.saveAllGroups();
      this.loadStoredGroups();

      if (isSelectedGroup) {
        console.log(`🗑️ Deleted selected group "${groupName}". Clearing all data...`);
        
        this.sharedData.clearExamDates();
        this.sharedData.clearSelectedExamGroup();
        this.sharedData.clearActiveTerm();
        
        if (groupToDelete && groupToDelete.termYear) {
          this.sharedData.clearStudentMappingForGroup(groupName, groupToDelete.termYear);
          console.log(`🗑️ Cleared student mapping for "${groupName}" (${groupToDelete.termYear})`);
        }
        
        this.sharedData.clearStudentMapping();
        
        alert(`⚠️ Deleted "${groupName}". All associated data has been cleared.`);
      } else {
        if (groupToDelete && groupToDelete.termYear) {
          this.sharedData.clearStudentMappingForGroup(groupName, groupToDelete.termYear);
          console.log(`🗑️ Cleared student mapping for "${groupName}" (${groupToDelete.termYear})`);
        }
        
        alert(`✅ Deleted "${groupName}".`);
      }
    }
  }

  selectGroup(group: ExamGroup) {
    this.selectedGroupName = group.name;
    
    this.sharedData.setExamDates(group.days);
    this.sharedData.setSelectedExamGroup(group);
    
    if (group.termYear) {
      this.sharedData.setActiveTerm(group.termYear);
      console.log(`✅ Set term to: ${group.termYear}`);
    }
    
    console.log(`✅ Selected "${group.name}" with ${group.days.length} days:`, group.days);
    alert(`✅ Selected "${group.name}" for scheduling.`);
  }

  closeDialog() {
    if (this.dialogRef) {
      this.dialogRef.close();
    }
  }

  dateFilter = (date: Date | null): boolean => {
    if (!date) return true;
    const selectedDates = this.examDays
      .map(d => d.date instanceof Date ? d.date.toDateString() : null)
      .filter(d => d !== null);
    return !selectedDates.includes(date.toDateString());
  };

  getTermAndYear(group: ExamGroup): string {
  if (!group.termYear) {
    const year = new Date().getFullYear();
    return `1st Semester SY ${year}-${year + 1}`;
  }
  
  // ✅ If already in text format, return as-is
  if (group.termYear.includes('Semester') || group.termYear.includes('Summer') || group.termYear.includes('Term')) {
    return group.termYear;
  }
  
  // ✅ FIXED: Convert numeric code to "Semester SY" format
  // Format: "2023241" → "1st Semester SY 2023-2024"
  if (/^\d{7}$/.test(group.termYear)) {
    const termMap: any = { '1': '1st Semester', '2': '2nd Semester', '3': 'Summer' };
    const termCode = group.termYear.slice(-1);
    const year1 = group.termYear.slice(0, 4);
    const year2Short = group.termYear.slice(4, 6);
    const year2 = '20' + year2Short;
    
    return `${termMap[termCode] || 'Unknown'} SY ${year1}-${year2}`;
  }
  
  return 'Unknown';
}

  getDateRange(days: ExamDay[]): string {
    if (!days || days.length === 0) return '-';

    const sorted = [...days].sort(
      (a, b) => new Date(a.date!).getTime() - new Date(b.date!).getTime()
    );

    const dateStrings = sorted.map(d => {
      const dt = new Date(d.date!);
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      const dd = String(dt.getDate()).padStart(2, '0');
      const yy = String(dt.getFullYear()).slice(-2);
      const weekday = dt.toLocaleDateString('en-US', { weekday: 'long' });
      return `${mm}/${dd}/${yy} (${weekday})`;
    });

    return dateStrings.join(', ');
  }

  isFormInvalid(): boolean {
    const hasValidDates = this.examDays.filter(d => d.date).length > 0;
    const hasGroupName = this.newGroupName && this.newGroupName.trim().length > 0;
    return !this.selectedTermYear || !hasGroupName || !hasValidDates;
  }

  onDateChange(day: ExamDay) {
  if (day.date) {
    day.am = true;
    day.pm = true;
  } else {
    day.am = false;
    day.pm = false;
  }
}



}