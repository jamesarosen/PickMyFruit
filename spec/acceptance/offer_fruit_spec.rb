require File.expand_path(File.dirname(__FILE__) + '/acceptance_helper')

feature "Offer Fruit", %q{
  In order to avoid wasting fruit
  As a grower
  I want to list my fruit tree as being available for picking
} do

  scenario "Learn more about sharing my fruit" do
    visit "/"
    within :css, '#main' do
      click_link "For Growers"
    end
    page.should have_css('ol li', :text => 'You list a tree on PickMyFruit')
    page.should have_css('ol li', :text => 'People come to share in the bounty')
  end
end
